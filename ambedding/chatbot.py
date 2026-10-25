import os
import uuid
import json
from datetime import datetime

from dotenv import load_dotenv
from openai import OpenAI


# ============================================================
# LOAD ENV
# ============================================================

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")


# ============================================================
# OPENAI CLIENT
# ============================================================

openai_client = None

if OPENAI_API_KEY:
    openai_client = OpenAI(
        api_key=OPENAI_API_KEY
    )

    print("✅ OpenAI client initialized")

else:
    print(
        "⚠️ Warning: OPENAI_API_KEY not set "
        "for chatbot responses."
    )


# ============================================================
# CHAT SESSION STORAGE
# ============================================================

chat_sessions = {}

MAX_HISTORY_ITEMS = 30


# ============================================================
# HELPERS
# ============================================================

def _normalize_bool(value):

    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return bool(value)

    if isinstance(value, str):
        return value.strip().lower() in (
            "true",
            "1",
            "yes",
            "y",
            "on"
        )

    return False


def _now_iso():

    return datetime.utcnow().isoformat() + "Z"


# ============================================================
# CREATE CHAT SESSION
# ============================================================

def create_chat_session(user_id=None):

    session_id = str(
        uuid.uuid4()
    )

    user_identifier = (
        user_id
        or f"user_{session_id[:8]}"
    )

    session = {

        "sessionId": session_id,

        "userId": user_identifier,

        "createdAt": _now_iso(),

        "chatHistory": []
    }

    chat_sessions[session_id] = session

    return session


# ============================================================
# GET CHAT SESSION
# ============================================================

def get_chat_session(session_id):

    return chat_sessions.get(
        session_id
    )


# ============================================================
# TRIM HISTORY
# ============================================================

def _trim_history(history):

    return history[
        -MAX_HISTORY_ITEMS:
    ]


# ============================================================
# BUILD OPENAI INPUT
# ============================================================

def _build_messages(
    chat_history,
    user_message
):

    messages = [

        {
            "role": "system",

            "content": """
You are a helpful chatbot assistant for emergency situations.

Your job is to provide clear, concise, and professional
assistance based on the user's message and conversation history.

IMPORTANT SAFETY RULES:

- Do not invent information.
- Do not claim that emergency services have been contacted.
- Do not claim that you can physically intervene.
- If the user describes an immediate life-threatening emergency,
  strongly recommend contacting the appropriate local emergency
  service immediately.
- Keep emergency instructions practical and easy to understand.
- Do not overwhelm the user with unnecessary information.

AVAILABLE VIDEO SUGGESTIONS:

You may suggest one of these videos ONLY when it is directly
relevant to the user's situation:

1. CPR:
   assets/suggestions/cpr.mp4

   Description:
   3D medical animation showing heart compressions and blood flow.

2. Severe bleeding / tourniquet:
   assets/suggestions/bloodwoundheel.mp4

   Description:
   Step-by-step animation on stopping arterial bleeding.

3. Choking / Heimlich:
   assets/suggestions/humanthroatandlungs.mp4

   Description:
   3D visualization of diaphragm thrust ejecting an object
   from the throat.

If no video is relevant, suggestedVideo must be null.

Return ONLY valid JSON with this exact structure:

{
    "message": "your response text",
    "suggestedVideo": "video path or null"
}
"""
        }
    ]


    # ========================================================
    # ADD CHAT HISTORY
    # ========================================================

    for message in chat_history:

        role = message.get(
            "role"
        )

        content = message.get(
            "message",
            ""
        )

        if role == "user":

            messages.append({
                "role": "user",
                "content": content
            })

        elif role == "assistant":

            messages.append({
                "role": "assistant",
                "content": content
            })


    # ========================================================
    # ADD CURRENT USER MESSAGE
    # ========================================================

    messages.append({

        "role": "user",

        "content": user_message
    })


    return messages


# ============================================================
# FALLBACK RESPONSE
# ============================================================

def _fallback_response(
    user_message
):

    lower_text = (
        user_message
        .lower()
        .strip()
    )


    # ========================================================
    # CPR
    # ========================================================

    if (
        "cpr" in lower_text
        or "heart attack" in lower_text
        or "not breathing" in lower_text
        or "unconscious" in lower_text
    ):

        return {

            "message": (
                "If the person is unresponsive and not breathing "
                "normally, contact emergency services immediately "
                "and begin CPR if you are trained to do so. "
                "You can also watch the CPR demonstration video."
            ),

            "suggestedVideo":
                "assets/suggestions/cpr.mp4"
        }


    # ========================================================
    # SEVERE BLEEDING
    # ========================================================

    if (
        "bleeding" in lower_text
        or "blood" in lower_text
        or "wound" in lower_text
        or "tourniquet" in lower_text
    ):

        return {

            "message": (
                "For severe bleeding, apply firm direct pressure "
                "to the wound and contact emergency services. "
                "A tourniquet may be appropriate for life-threatening "
                "bleeding when trained to use one. "
                "You can watch the bleeding-control demonstration."
            ),

            "suggestedVideo":
                "assets/suggestions/bloodwoundheel.mp4"
        }


    # ========================================================
    # CHOKING
    # ========================================================

    if (
        "choking" in lower_text
        or "heimlich" in lower_text
        or "throat" in lower_text
    ):

        return {

            "message": (
                "If someone is choking and cannot breathe, speak, "
                "or cough effectively, contact emergency services "
                "and provide appropriate choking first aid if you "
                "are trained to do so. "
                "You can watch the choking demonstration video."
            ),

            "suggestedVideo":
                "assets/suggestions/humanthroatandlungs.mp4"
        }


    # ========================================================
    # EMERGENCY
    # ========================================================

    if any(
        word in lower_text
        for word in [
            "help",
            "emergency",
            "fire",
            "accident",
            "medical",
            "police",
            "ambulance",
            "danger",
            "urgent"
        ]
    ):

        return {

            "message": (
                "I understand this may be urgent. "
                "If there is immediate danger or someone is "
                "seriously injured, contact the appropriate "
                "local emergency service immediately. "
                "Please share the situation and I will help "
                "you with the available information."
            ),

            "suggestedVideo": None
        }


    # ========================================================
    # GREETING
    # ========================================================

    if (
        lower_text == "hello"
        or lower_text == "hi"
        or lower_text.startswith("hello ")
        or lower_text.startswith("hi ")
    ):

        return {

            "message":
                "Hello! How can I help you today?",

            "suggestedVideo": None
        }


    # ========================================================
    # DEFAULT
    # ========================================================

    return {

        "message": (
            "Thanks for your message. "
            "I am here to help you with emergency-related "
            "questions and requests."
        ),

        "suggestedVideo": None
    }


# ============================================================
# GENERATE OPENAI RESPONSE
# ============================================================

def _generate_response(
    session,
    user_message
):

    # ========================================================
    # CHECK OPENAI CLIENT
    # ========================================================

    if openai_client is None:

        print(
            "⚠️ OpenAI client unavailable. "
            "Using fallback response."
        )

        return _fallback_response(
            user_message
        )


    try:

        print(
            "🤖 Generating chatbot response with OpenAI..."
        )


        # ====================================================
        # BUILD MESSAGES
        # ====================================================

        messages = _build_messages(
            session["chatHistory"],
            user_message
        )


        # ====================================================
        # OPENAI REQUEST
        # ====================================================

        response = openai_client.responses.create(

            model="gpt-5.5",

            input=messages,

            text={

                "format": {

                    "type": "json_schema",

                    "name": "emergency_chat_response",

                    "strict": True,

                    "schema": {

                        "type": "object",

                        "properties": {

                            "message": {

                                "type": "string"
                            },

                            "suggestedVideo": {

                                "type": [
                                    "string",
                                    "null"
                                ]
                            }
                        },

                        "required": [
                            "message",
                            "suggestedVideo"
                        ],

                        "additionalProperties": False
                    }
                }
            }
        )


        # ====================================================
        # GET OUTPUT
        # ====================================================

        text = (
            response.output_text.strip()
        )


        print(
            f"🤖 OpenAI response: {text}"
        )


        if not text:

            raise ValueError(
                "OpenAI returned an empty response"
            )


        # ====================================================
        # PARSE JSON
        # ====================================================

        try:

            result = json.loads(
                text
            )

        except json.JSONDecodeError:

            print(
                "⚠️ OpenAI returned non-JSON response. "
                "Using response as plain text."
            )

            return {

                "message": text,

                "suggestedVideo": None
            }


        # ====================================================
        # VALIDATE RESPONSE
        # ====================================================

        message = result.get(
            "message"
        )

        suggested_video = result.get(
            "suggestedVideo"
        )


        if not isinstance(
            message,
            str
        ):

            message = (
                "I am sorry, I could not "
                "process your request."
            )


        # ====================================================
        # VALID VIDEO PATHS
        # ====================================================

        valid_videos = {

            "assets/suggestions/cpr.mp4",

            "assets/suggestions/bloodwoundheel.mp4",

            "assets/suggestions/humanthroatandlungs.mp4"
        }


        if (
            suggested_video
            not in valid_videos
        ):

            suggested_video = None


        # ====================================================
        # FINAL RESULT
        # ====================================================

        return {

            "message": message,

            "suggestedVideo":
                suggested_video
        }


    except Exception as error:

        print(
            f"❌ OpenAI chatbot error: {error}"
        )

        print(
            "⚠️ Falling back to local response."
        )

        return _fallback_response(
            user_message
        )


# ============================================================
# HANDLE CHATBOT REQUEST
# ============================================================

def handle_chatbot_request(
    data
):

    # ========================================================
    # VALIDATE REQUEST BODY
    # ========================================================

    if not isinstance(
        data,
        dict
    ):

        return {

            "status": "error",

            "message":
                "Request body must be a JSON object"

        }, 400


    # ========================================================
    # GET MESSAGE
    # ========================================================

    message = (
        data.get("message")
        or data.get("text")
    )


    if (
        not message
        or not isinstance(
            message,
            str
        )
        or not message.strip()
    ):

        return {

            "status": "error",

            "message": (
                "The 'message' field is required "
                "and must be a non-empty string."
            )

        }, 400


    message = message.strip()


    # ========================================================
    # GET USER / SESSION INFORMATION
    # ========================================================

    user_id = data.get(
        "userId"
    )


    session_flag = _normalize_bool(
        data.get(
            "session",
            False
        )
    )


    requested_session_id = data.get(
        "sessionId"
    )


    # ========================================================
    # SESSION LOGIC
    # ========================================================

    if (
        session_flag
        and requested_session_id
    ):

        session = get_chat_session(
            requested_session_id
        )

        created_new_session = False


        if session is None:

            session = create_chat_session(
                user_id
            )

            created_new_session = True


    else:

        session = create_chat_session(
            user_id
        )

        created_new_session = True


    # ========================================================
    # UPDATE USER ID
    # ========================================================

    if (
        user_id
        and not session.get("userId")
    ):

        session["userId"] = user_id


    # ========================================================
    # ADD USER MESSAGE
    # ========================================================

    user_message_entry = {

        "role": "user",

        "message": message,

        "timestamp": _now_iso()
    }


    session["chatHistory"].append(
        user_message_entry
    )


    session["chatHistory"] = _trim_history(
        session["chatHistory"]
    )


    # ========================================================
    # GENERATE ASSISTANT RESPONSE
    # ========================================================

    assistant_response = _generate_response(

        session,

        message
    )


    # ========================================================
    # ADD ASSISTANT MESSAGE
    # ========================================================

    assistant_entry = {

        "role": "assistant",

        "message":
            assistant_response["message"],

        "timestamp": _now_iso()
    }


    session["chatHistory"].append(
        assistant_entry
    )


    session["chatHistory"] = _trim_history(
        session["chatHistory"]
    )


    # ========================================================
    # RESPONSE
    # ========================================================

    response_body = {

        "status": "success",

        "sessionId":
            session["sessionId"],

        "message":
            assistant_response["message"],

        "suggestedVideo":
            assistant_response["suggestedVideo"]
    }


    return response_body, 200