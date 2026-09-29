"""AI providers for VIGIL AI — mock (default) and real LLMs.

A real provider plugs in via environment variables; the key never reaches
the client. All live providers:
  - receive the conversation history (already sanitized),
  - get the same system prompt and safety rules as the mock,
  - are called through the server-side proxy only.

Emergency/medical redirects are handled BEFORE the provider is invoked
(see ai_api.py), so no provider ever sees a crisis message.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

import config

SYSTEM_PROMPT = (
    "You are VIGIL AI, a calm and supportive wellness assistant for operational personnel. "
    "You are NOT a medical professional. You never diagnose, prescribe, or replace emergency services. "
    "You encourage rest, hydration, connection with trusted people, and professional support when needed. "
    "Keep replies warm, brief (under 150 words), and end with something grounded and practical."
)

# Language behaviour (multilingual & inclusive support):
#   - The user's selected language shapes HOW the assistant speaks, never WHAT
#     it may access. Scores, permissions and data are untouched.
#   - Hinglish is a natural conversational mode — mixed Hindi/English in Roman
#     script — NOT formal Hindi and NOT a translation mode.
#   - The user may write in any language; reply in their preferred language
#     unless they explicitly ask for another.
#   - Model quality varies by language; the prompt asks for natural output in
#     the selected language without overclaiming capability (the UI says so).
LANGUAGE_PROMPTS = {
    "en": "",
    "hi": ("Reply in natural Hindi (Devanagari script). "
           "Keep technical terms like Recovery Score, Stress Score, Shift and Workload in "
           "their commonly understood form. If the user writes in another language, still "
           "reply in Hindi unless they ask otherwise. Never invent numbers — VIGIL's scores "
           "come from the app, not from you."),
    "hinglish": ("Reply in natural conversational Hinglish: Roman-script Hindi mixed with "
           "English, the way Indian colleagues actually talk (e.g. 'Aaj shift ke baad kaafi "
           "exhausted feel ho raha hai'). Understand mixed-language input freely — Hindi, "
           "English, or both in one sentence. Stay warm and professional, not slang-heavy. "
           "Never invent numbers — VIGIL's scores come from the app, not from you."),
    "mr": "Reply in natural Marathi (Devanagari script). Keep VIGIL terms (Recovery Score, Shift, Workload) commonly understood. Never invent numbers.",
    "ta": "Reply in natural Tamil (Tamil script). Keep VIGIL terms (Recovery Score, Shift, Workload) commonly understood. Never invent numbers.",
    "bn": "Reply in natural Bengali (Bengali script). Keep VIGIL terms (Recovery Score, Shift, Workload) commonly understood. Never invent numbers.",
    "pa": "Reply in natural Punjabi (Gurmukhi script). Keep VIGIL terms (Recovery Score, Shift, Workload) commonly understood. Never invent numbers.",
    "as": "Reply in natural Assamese (Assamese/Bengali script). Keep VIGIL terms (Recovery Score, Shift, Workload) commonly understood. Never invent numbers.",
}


def system_prompt_for(language: str | None) -> str:
    """System prompt including the language directive (English if unknown)."""
    directive = LANGUAGE_PROMPTS.get((language or "en"), "")
    return SYSTEM_PROMPT + (" " + directive if directive else "")


class MockAIProvider:
    """Deterministic, supportive mock responses for demo mode."""

    SAFETY_REDIRECT = (
        "Thank you for sharing that. I'm not able to help with medical decisions or emergencies. "
        "If this is urgent, please contact your Medic Officer or emergency services now. "
        "For everything else, I'm here to help you rest, plan, and reconnect with your support network."
    )

    def complete(self, messages: list[dict], language: str = "en") -> str:
        last = messages[-1]["content"].lower() if messages else ""
        if any(k in last for k in ("emergency", "chest pain", "suicid", "self-harm", "overdose")):
            return self.SAFETY_REDIRECT
        if any(k in last for k in ("stress", "anxious", "anxiety", "overwhelm")) and language == "hinglish":
            return ("Pressure zyada lag rahi hai — samajh sakte hain. Abhi ke liye do minute ka "
                    "breathing pause De-stress Zone mein try kariye, ek chhota walk, aur apne "
                    "Stress Load factors dekhiye ki load kahan se aa raha hai. Agar pressure "
                    "badhta hi jaye, toh Medic Officer aur supervisor dono ek tap door hain.")
        if any(k in last for k in ("stress", "anxious", "anxiety", "overwhelm")):
            return ("That sounds demanding. A few things that may help right now: a two-minute breathing "
                    "pause in the De-stress Zone, a short walk before your next block of work, and a look at "
                    "your Recovery Score factors to see what your body is asking for. If the pressure keeps "
                    "building, your Medic Officer and supervisor are one tap away — reaching out is a strength.")
        if any(k in last for k in ("sleep", "tired", "exhaust", "fatigue")):
            return ("Rest is mission-critical, not a luxury. Your sleep trend and Recovery Score factors can "
                    "show what's draining you. Tonight, try dimming screens 30 minutes before bed and using the "
                    "Sleep mix in the De-stress Zone. If exhaustion persists across several days, consider a "
                    "quiet word with your Medic Officer.")
        if any(k in last for k in ("exhaust", "tired", "thak", "sleep", "so ", "neend")) and language == "hinglish":
            return ("Aaj kaafi heavy lag raha hai — rest bhi utna hi zaroori hai jaise kaam. "
                    "Aapka Recovery Score aur sleep trend batayenge ki body ko kya chahiye. "
                    "Aaj raat screens 30 minute pehle band karke De-stress Zone ka Sleep mix try kariye. "
                    "Agar exhaustion lagataar bana rahe, toh Medic Officer se ek baat kar lena — "
                    "reach out karna strength hai, weakness nahi.")
        if any(k in last for k in ("task", "workload", "deadline", "organize", "organise", "kaam")) and language == "hinglish":
            return ("Workload visible karna best hai. Task list ko deadline aur priority se sort kariye — "
                    "ek chhoti jeet se shuru kariye. Agar load unbalanced lag raha ho, toh supervisor "
                    "connection hi sahi channel hai. Aapko akele sab carry nahi karna.")
        if language == "hinglish":
            return ("Main yahan hoon. Main aapki Recovery Score samajhne, week ka summary, ek calming track "
                    "dhoondhne, ya bas ek heavy din ke baare mein baat karne mein madad kar sakta hoon. "
                    "Abhi kya sabse useful lagega?")
        return ("I'm here with you. I can help you understand your Recovery Score, summarise your week, "
                "find a calming track, or simply think through a heavy day. What would feel most useful right now?")


class OpenAIProvider:
    """OpenAI Chat Completions via stdlib urllib. Key from env only."""

    API_URL = "https://api.openai.com/v1/chat/completions"

    def __init__(self, api_key: str, model: str = "gpt-4o-mini", timeout: int = 30):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def complete(self, messages: list[dict], language: str = "en") -> str:
        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": system_prompt_for(language)}] + messages[-12:],
            "max_tokens": 300,
            "temperature": 0.7,
        }).encode()
        req = urllib.request.Request(
            self.API_URL, data=payload, method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                body = json.loads(res.read().decode())
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"LLM provider error (HTTP {exc.code})") from None
        except urllib.error.URLError as exc:
            raise RuntimeError("LLM provider unreachable") from exc
        try:
            return body["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError):
            raise RuntimeError("LLM provider returned an unexpected shape") from None


class AnthropicProvider:
    """Anthropic Messages API via stdlib urllib. Key from env only."""

    API_URL = "https://api.anthropic.com/v1/messages"
    VERSION = "2023-06-01"

    def __init__(self, api_key: str, model: str = "claude-3-5-haiku-latest", timeout: int = 30):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def complete(self, messages: list[dict], language: str = "en") -> str:
        payload = json.dumps({
            "model": self.model,
            "system": system_prompt_for(language),
            "messages": messages[-12:],
            "max_tokens": 300,
        }).encode()
        req = urllib.request.Request(
            self.API_URL, data=payload, method="POST",
            headers={"Content-Type": "application/json",
                     "x-api-key": self.api_key,
                     "anthropic-version": self.VERSION},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                body = json.loads(res.read().decode())
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"LLM provider error (HTTP {exc.code})") from None
        except urllib.error.URLError as exc:
            raise RuntimeError("LLM provider unreachable") from exc
        try:
            return "".join(block.get("text", "") for block in body["content"]).strip()
        except (KeyError, TypeError):
            raise RuntimeError("LLM provider returned an unexpected shape") from None


def get_provider():
    """Return the configured provider. Mock stays the default until env keys exist."""
    i = config.INTEGRATIONS
    name = i.get("ai_provider", "mock")
    if name == "openai" and i.get("ai_api_key"):
        return OpenAIProvider(i["ai_api_key"], i.get("ai_model", "gpt-4o-mini"))
    if name == "anthropic" and i.get("ai_api_key"):
        return AnthropicProvider(i["ai_api_key"], i.get("ai_model", "claude-3-5-haiku-latest"))
    return MockAIProvider()
