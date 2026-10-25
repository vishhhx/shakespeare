import os
import uuid
import boto3
import numpy as np
import cv2
import json

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from qdrant_client import QdrantClient
from deepface import DeepFace

from voice_to_text import transcribe_audio
from chatbot import handle_chatbot_request

from openai import OpenAI


# ==============================
# LOAD ENV
# ==============================

load_dotenv()


AWS_REGION = os.getenv("AWS_REGION")

S3_BUCKET = os.getenv("S3_BUCKET")
S3_BUCKET_EMEGENCY = os.getenv("S3_BUCKET_EMERGE")
S3_AUDIO = os.getenv("S3_AUDIO")

QDRANT_URL = os.getenv(
    "QDRANT_URL",
    "http://localhost:6333"
)

QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")

COLLECTION_NAME = os.getenv(
    "COLLECTION_NAME",
    "faces"
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")


# ==============================
# VALIDATE ENV
# ==============================

if not S3_BUCKET:
    raise Exception("Missing S3_BUCKET")

if not QDRANT_URL:
    raise Exception("Missing Qdrant URL")

if not S3_BUCKET_EMEGENCY:
    raise Exception("Missing S3_EMERGE")

if not S3_AUDIO:
    raise Exception("S3_AUDIO not found")


# ==============================
# CLIENTS
# ==============================

print("🔌 Connecting to S3...")

s3 = boto3.client(
    "s3",
    region_name=AWS_REGION
)


# --------------------------------
# OpenAI Client
# --------------------------------

openai_client = None

if OPENAI_API_KEY:

    print("🤖 Initializing OpenAI...")

    openai_client = OpenAI(
        api_key=OPENAI_API_KEY
    )

    print("✅ OpenAI client initialized")

else:

    print(
        "⚠️ Warning: OPENAI_API_KEY not set. "
        "Audio analysis will use fallback analysis."
    )


# --------------------------------
# Qdrant Client
# --------------------------------

print("🔌 Connecting to Qdrant...")

qdrant_client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY or None
)


# ==============================
# ENSURE QDRANT COLLECTION
# ==============================

try:

    print("📦 Checking Qdrant collection...")

    collections = qdrant_client.get_collections().collections

    names = [
        collection.name
        for collection in collections
    ]

    if COLLECTION_NAME not in names:

        print(
            f"📦 Collection '{COLLECTION_NAME}' "
            "does not exist. Creating..."
        )

        qdrant_client.recreate_collection(
            collection_name=COLLECTION_NAME,
            vectors_config={
                "size": 512,
                "distance": "Cosine"
            }
        )

        print("✅ Qdrant collection created")

    else:

        print(
            "✅ Qdrant connected:",
            names
        )

except Exception as e:

    print(
        "❌ Qdrant init error:",
        e
    )


# ==============================
# FLASK APP
# ==============================

app = Flask(__name__)

app.config["JSON_SORT_KEYS"] = False

CORS(app)


# ==============================
# ERROR HANDLERS
# ==============================

@app.errorhandler(415)
def handle_415(error):

    return jsonify({
        "status": "error",
        "message": (
            "Content-Type must be "
            "'application/json'. "
            "Make sure to set the "
            "Content-Type header in your request."
        ),
        "received_content_type": request.content_type
    }), 415


# ==============================
# HEALTH CHECK
# ==============================

@app.route("/health", methods=["GET"])
def health():

    return jsonify({
        "status": "ok"
    }), 200


# ==============================
# LOAD DEEPFACE
# ==============================

print("🔥 Loading DeepFace model (ArcFace)...")

DeepFace.build_model("ArcFace")

print("✅ Model loaded successfully")


# ==============================
# EMBEDDING
# ==============================

def get_embedding(image_bytes):

    print(
        "🧠 Converting image to numpy..."
    )

    np_arr = np.frombuffer(
        image_bytes,
        np.uint8
    )

    print(
        "🖼️ Decoding image..."
    )

    img = cv2.imdecode(
        np_arr,
        cv2.IMREAD_COLOR
    )

    # Validate image
    if img is None:

        raise Exception(
            "Failed to decode image. "
            "Please ensure the image is a valid "
            "JPEG/PNG file."
        )

    print(
        f"📏 Image shape: {img.shape}"
    )

    print(
        "🚀 Running DeepFace embedding..."
    )

    try:

        result = DeepFace.represent(
            img_path=img,
            model_name="ArcFace",
            enforce_detection=False
        )

    except Exception as e:

        print(
            f"❌ DeepFace error: {e}"
        )

        raise Exception(
            f"Face detection failed: {str(e)}"
        )

    if not result:

        raise Exception(
            "No face detected in the image. "
            "Please ensure the image contains "
            "a clear, frontal face photo."
        )

    if len(result) > 1:

        print(
            f"⚠️ Multiple faces detected "
            f"({len(result)}), using the first one"
        )

    print(
        "✅ Embedding created"
    )

    return result[0]["embedding"]


# ==============================
# SEARCH QDRANT
# ==============================

def search_qdrant(embedding):

    try:

        print(
            "🔍 Searching in Qdrant..."
        )

        result = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            query=embedding,
            limit=1
        )

        if result.points:

            point = result.points[0]

            print(
                f"✅ Match found "
                f"(score: {point.score})"
            )

            return (
                point.score,
                point.id
            )

        print(
            "ℹ️ No match found"
        )

        return None, None

    except Exception as e:

        print(
            "❌ Qdrant search error:",
            e
        )

        return None, None


# ==============================
# UPSERT QDRANT
# ==============================

def upsert_qdrant(
    user_id,
    embedding
):

    try:

        print(
            "💾 Storing embedding in Qdrant..."
        )

        vector_id = str(
            uuid.uuid4()
        )

        qdrant_client.upsert(
            collection_name=COLLECTION_NAME,
            points=[
                {
                    "id": vector_id,

                    "vector": embedding,

                    "payload": {
                        "userId": user_id,
                        "embeddingId": vector_id
                    }
                }
            ]
        )

        print(
            f"✅ Stored embedding for {user_id}"
        )

        return vector_id

    except Exception as e:

        print(
            "❌ Qdrant insert error:",
            e
        )

        return None


# ============================================================
# ANALYZE AUDIO TEXT WITH OPENAI
# ============================================================

def analyze_audio_text(transcribed_text):

    """
    Analyze transcribed emergency audio using OpenAI.

    Returns:

        {
            "type":
                "medical"
                | "fire"
                | "crime"
                | "accident"
                | "missing_child"
                | "other",

            "severity":
                "low"
                | "medium"
                | "high"
                | "critical",

            "status":
                "reported",

            "analysis":
                "detailed analysis text"
        }
    """

    # ========================================================
    # FALLBACK ANALYSIS
    # ========================================================

    def fallback_analysis(text):

        """
        Basic keyword-based emergency analysis.
        Used when OpenAI is unavailable.
        """

        if not text:

            return {
                "type": "other",
                "severity": "low",
                "status": "reported",
                "analysis": (
                    "No transcription text available."
                )
            }

        text_lower = text.lower()


        # ====================================================
        # DETERMINE TYPE
        # ====================================================

        if any(
            word in text_lower
            for word in [
                "heart",
                "pain",
                "chest",
                "blood",
                "medical",
                "doctor",
                "hospital",
                "injury",
                "injured",
                "unconscious"
            ]
        ):

            analysis_type = "medical"


        elif any(
            word in text_lower
            for word in [
                "fire",
                "burning",
                "smoke",
                "flame",
                "explosion",
                "exploded"
            ]
        ):

            analysis_type = "fire"


        elif any(
            word in text_lower
            for word in [
                "crime",
                "robbery",
                "robbed",
                "assault",
                "violence",
                "attack",
                "police",
                "thief"
            ]
        ):

            analysis_type = "crime"


        elif any(
            word in text_lower
            for word in [
                "accident",
                "crash",
                "collision",
                "car accident",
                "vehicle",
                "bike accident"
            ]
        ):

            analysis_type = "accident"


        elif any(
            word in text_lower
            for word in [
                "missing",
                "child",
                "kid",
                "abduct",
                "abduction",
                "disappeared"
            ]
        ):

            analysis_type = "missing_child"


        else:

            analysis_type = "other"


        # ====================================================
        # DETERMINE SEVERITY
        # ====================================================

        if any(
            word in text_lower
            for word in [
                "critical",
                "life threatening",
                "life-threatening",
                "dying",
                "dead",
                "unconscious",
                "emergency",
                "urgent",
                "can't breathe",
                "cannot breathe",
                "not breathing"
            ]
        ):

            analysis_severity = "critical"


        elif any(
            word in text_lower
            for word in [
                "serious",
                "severe",
                "bad",
                "heavy",
                "major",
                "high"
            ]
        ):

            analysis_severity = "high"


        elif any(
            word in text_lower
            for word in [
                "moderate",
                "medium"
            ]
        ):

            analysis_severity = "medium"


        else:

            analysis_severity = "low"


        return {
            "type": analysis_type,
            "severity": analysis_severity,
            "status": "reported",
            "analysis": (
                f"Basic keyword analysis: "
                f"{text[:200]}"
            )
        }


    # ========================================================
    # VALIDATE OPENAI CLIENT
    # ========================================================

    if openai_client is None:

        print(
            "⚠️ OPENAI_API_KEY not configured. "
            "Using fallback analysis."
        )

        return fallback_analysis(
            transcribed_text
        )


    # ========================================================
    # OPENAI ANALYSIS
    # ========================================================

    try:

        print(
            "🤖 Analyzing text with OpenAI..."
        )


        # ====================================================
        # INSTRUCTIONS
        # ====================================================

        instructions = """
You are an emergency report classification system.

Analyze the provided emergency report and classify it.

Emergency types:

- medical:
  Health emergencies, injuries, illness, unconsciousness,
  breathing problems, chest pain, bleeding, etc.

- fire:
  Fire, explosion, smoke, burning, or fire-related emergencies.

- crime:
  Robbery, theft, assault, violence, attack, or other crimes.

- accident:
  Traffic accidents, vehicle crashes, collisions, falls,
  or other accidental injuries.

- missing_child:
  A child who is missing, abducted, or has disappeared.

- other:
  Anything that does not clearly belong to the categories above.

Severity:

- low:
  Minor situation with little immediate danger.

- medium:
  Moderate emergency requiring attention but not immediately
  life-threatening.

- high:
  Serious emergency with significant danger or potential
  serious injury.

- critical:
  Immediate life-threatening situation or extreme danger.

Important rules:

1. Classify based only on the information provided.
2. Do not invent facts.
3. If multiple emergency types are mentioned, select the
   primary emergency.
4. If severity is unclear but there are indications of
   immediate danger, choose the safer/higher severity.
5. Return only the requested JSON structure.
"""


        # ====================================================
        # OPENAI REQUEST
        # ====================================================

        response = openai_client.responses.create(

            model="gpt-5.5",

            instructions=instructions,

            input=(
                "Emergency report transcription:\n\n"
                f"{transcribed_text}"
            ),

            text={
                "format": {

                    "type": "json_schema",

                    "name": "emergency_analysis",

                    "strict": True,

                    "schema": {

                        "type": "object",

                        "properties": {

                            "type": {
                                "type": "string",
                                "enum": [
                                    "medical",
                                    "fire",
                                    "crime",
                                    "accident",
                                    "missing_child",
                                    "other"
                                ]
                            },

                            "severity": {
                                "type": "string",
                                "enum": [
                                    "low",
                                    "medium",
                                    "high",
                                    "critical"
                                ]
                            },

                            "analysis": {
                                "type": "string"
                            }
                        },

                        "required": [
                            "type",
                            "severity",
                            "analysis"
                        ],

                        "additionalProperties": False
                    }
                }
            }
        )


        # ====================================================
        # GET RESPONSE
        # ====================================================

        response_text = (
            response.output_text.strip()
        )

        print(
            f"🤖 OpenAI response: "
            f"{response_text}"
        )


        if not response_text:

            raise Exception(
                "OpenAI returned an empty response"
            )


        # ====================================================
        # PARSE JSON
        # ====================================================

        result = json.loads(
            response_text
        )


        # ====================================================
        # VALIDATE TYPE
        # ====================================================

        valid_types = [
            "medical",
            "fire",
            "crime",
            "accident",
            "missing_child",
            "other"
        ]


        valid_severities = [
            "low",
            "medium",
            "high",
            "critical"
        ]


        analysis_type = result.get(
            "type",
            "other"
        )

        analysis_severity = result.get(
            "severity",
            "low"
        )

        analysis_text = result.get(
            "analysis",
            ""
        )


        if analysis_type not in valid_types:

            analysis_type = "other"


        if analysis_severity not in valid_severities:

            analysis_severity = "low"


        # ====================================================
        # FINAL RESULT
        # ====================================================

        analysis_result = {

            "type": analysis_type,

            "severity": analysis_severity,

            "status": "reported",

            "analysis": analysis_text
        }


        print(
            f"✅ Analysis complete: "
            f"{analysis_result}"
        )


        return analysis_result


    except Exception as e:

        print(
            f"❌ OpenAI analysis error: {e}"
        )

        print(
            "⚠️ Switching to fallback analysis..."
        )

        return fallback_analysis(
            transcribed_text
        )


# ==============================
# PROCESS IMAGE
# ==============================

@app.route(
    "/process-image",
    methods=["POST"]
)
def process_image():

    print(
        "enter to s3"
    )

    try:

        # ====================================================
        # HANDLE JSON
        # ====================================================

        try:

            data = request.get_json(
                force=True,
                silent=False
            )

        except Exception as e:

            print(
                f"JSON parsing failed: {e}"
            )

            if request.data:

                data = json.loads(
                    request.data.decode(
                        "utf-8"
                    )
                )

            else:

                data = request.form.to_dict()


        # ====================================================
        # FILE KEY
        # ====================================================

        file_key = (
            data.get("fileKey")
            or data.get("filekey")
        )


        if not file_key:

            return jsonify({
                "error": "fileKey required"
            }), 400


        print(
            "\n=============================="
        )

        print(
            "📥 New Request Received"
        )

        print(
            "👉 fileKey:",
            file_key
        )


        # ====================================================
        # EXTRACT USER ID
        # ====================================================

        user_id = (
            file_key
            .split("/")[-1]
            .split(".")[0]
        )


        # ====================================================
        # FETCH IMAGE FROM S3
        # ====================================================

        print(
            "☁️ Fetching image from S3..."
        )


        s3_response = s3.get_object(
            Bucket=S3_BUCKET,
            Key=file_key
        )


        file_bytes = (
            s3_response["Body"].read()
        )


        print(
            "✅ Image fetched from S3"
        )


        # ====================================================
        # GENERATE EMBEDDING
        # ====================================================

        embedding = get_embedding(
            file_bytes
        )


        # ====================================================
        # STORE IN QDRANT
        # ====================================================

        embedding_id = upsert_qdrant(
            user_id,
            embedding
        )


        print(
            "🎯 Done processing\n"
        )

        print(
            "the embedding id",
            embedding_id
        )

        print(
            "the user id",
            user_id
        )


        return jsonify({

            "userId": user_id,

            "embeddingId": embedding_id

        })


    except Exception as e:

        print(
            "❌ ERROR:",
            str(e)
        )


        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500


# ==============================
# PROCESS EMERGENCY IMAGE
# ==============================

@app.route(
    "/process-image-EMERGENCY",
    methods=["POST"]
)
def process_image_EMERGE():

    print(
        "enter to s3"
    )

    try:

        # ====================================================
        # HANDLE JSON
        # ====================================================

        try:

            data = request.get_json(
                force=True,
                silent=False
            )

        except Exception as e:

            print(
                f"JSON parsing failed: {e}"
            )

            if request.data:

                data = json.loads(
                    request.data.decode(
                        "utf-8"
                    )
                )

            else:

                data = request.form.to_dict()


        # ====================================================
        # FILE KEY
        # ====================================================

        file_key = (
            data.get("fileKey")
            or data.get("filekey")
        )


        if not file_key:

            return jsonify({
                "error": "fileKey required"
            }), 400


        print(
            "\n=============================="
        )

        print(
            "📥 New Request Received"
        )

        print(
            "👉 fileKey:",
            file_key
        )


        # ====================================================
        # EXTRACT USER ID
        # ====================================================

        user_id = (
            file_key
            .split("/")[-1]
            .split(".")[0]
        )


        # ====================================================
        # FETCH IMAGE
        # ====================================================

        print(
            "☁️ Fetching image from S3..."
        )


        s3_response = s3.get_object(
            Bucket=S3_BUCKET_EMEGENCY,
            Key=file_key
        )


        file_bytes = (
            s3_response["Body"].read()
        )


        print(
            "✅ Image fetched from S3"
        )


        # ====================================================
        # GENERATE EMBEDDING
        # ====================================================

        embedding = get_embedding(
            file_bytes
        )


        # ====================================================
        # STORE EMBEDDING
        # ====================================================

        embedding_id = upsert_qdrant(
            user_id,
            embedding
        )


        print(
            "🎯 Done processing\n"
        )

        print(
            "the embedding id",
            embedding_id
        )

        print(
            "the user id",
            user_id
        )


        return jsonify({

            "userId": user_id,

            "embeddingId": embedding_id

        })


    except Exception as e:

        print(
            "❌ ERROR:",
            str(e)
        )


        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500


# ==============================
# AUDIO PROCESSING
# ==============================

@app.route(
    "/audio",
    methods=["POST"]
)
def audio_route():

    try:

        # ====================================================
        # HANDLE JSON
        # ====================================================

        try:

            data = request.get_json(
                force=True,
                silent=False
            )

        except Exception as e:

            print(
                f"JSON parsing failed: {e}"
            )

            if request.data:

                data = json.loads(
                    request.data.decode(
                        "utf-8"
                    )
                )

            else:

                data = request.form.to_dict()


        print(
            f"📨 Received data: {data}"
        )


        # ====================================================
        # FILE KEY
        # ====================================================

        file_key = (
            data.get("fileKey")
            or data.get("filekey")
        )


        if not file_key:

            print(
                "❌ fileKey missing from request"
            )

            return jsonify({

                "error": "fileKey required",

                "received": data

            }), 400


        print(
            "\n=============================="
        )

        print(
            "📥 Audio Request Received"
        )

        print(
            "👉 fileKey:",
            file_key
        )


        # ====================================================
        # FETCH AUDIO FROM S3
        # ====================================================

        print(
            "☁️ Fetching audio from S3 bucket:",
            S3_AUDIO
        )


        try:

            s3_response = s3.get_object(

                Bucket=S3_AUDIO,

                Key=file_key
            )


            audio_bytes = (
                s3_response["Body"].read()
            )


        except Exception as e:

            print(
                f"❌ S3 fetch error: {e}"
            )


            return jsonify({

                "status": "error",

                "message": (
                    "Failed to fetch audio "
                    f"from S3: {str(e)}"
                ),

                "bucket": S3_AUDIO,

                "key": file_key

            }), 404


        # ====================================================
        # VALIDATE AUDIO
        # ====================================================

        if len(audio_bytes) == 0:

            return jsonify({

                "status": "error",

                "message": "Audio file is empty"

            }), 400


        if len(audio_bytes) > 50 * 1024 * 1024:

            return jsonify({

                "status": "error",

                "message": (
                    "Audio file too large "
                    "(max 50MB)"
                )

            }), 400


        print(
            f"📏 Audio file size: "
            f"{len(audio_bytes)} bytes"
        )


        # ====================================================
        # SAVE TEMP AUDIO FILE
        # ====================================================

        temp_filename = (
            f"{uuid.uuid4()}_"
            f"{file_key.split('/')[-1]}"
        )


        try:

            with open(
                temp_filename,
                "wb"
            ) as f:

                f.write(audio_bytes)


            print(
                "📁 Temp audio file saved:",
                temp_filename
            )


            # =================================================
            # TRANSCRIBE
            # =================================================

            text = transcribe_audio(
                temp_filename
            )


        finally:

            # ================================================
            # CLEANUP
            # ================================================

            if os.path.exists(
                temp_filename
            ):

                os.remove(
                    temp_filename
                )

                print(
                    "🗑️ Temp file cleaned up"
                )


        # ====================================================
        # VALIDATE TRANSCRIPTION
        # ====================================================

        if not text:

            return jsonify({

                "status": "error",

                "message": (
                    "Audio transcription failed"
                )

            }), 500


        print(
            "✅ Transcription completed"
        )

        print(
            f"📝 Transcribed text: "
            f"{text[:100]}..."
        )


        # ====================================================
        # ANALYZE WITH OPENAI
        # ====================================================

        analysis = analyze_audio_text(
            text
        )


        print(
            "🎯 Analysis complete"
        )


        # ====================================================
        # FILE NAME
        # ====================================================

        file_name = (
            file_key
            .split("/")[-1]
        )


        # ====================================================
        # RESPONSE
        # ====================================================

        return jsonify({

            "status": "success",

            "fileName": file_name,

            "fileKey": file_key,

            "transcribedText": text,

            "analysis": {

                "type": analysis["type"],

                "severity": analysis["severity"],

                "status": analysis["status"],

                "reportedBy": file_name,

                "analysis": analysis["analysis"]

            }

        })


    except Exception as e:

        print(
            "❌ ERROR:",
            str(e)
        )


        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500


# ==============================
# CHATBOT
# ==============================

@app.route(
    "/chatbot",
    methods=["POST"]
)
def chatbot_route():

    try:

        try:

            data = request.get_json(
                force=True,
                silent=False
            )

        except Exception as e:

            print(
                f"JSON parsing failed: {e}"
            )

            if request.data:

                data = json.loads(
                    request.data.decode(
                        "utf-8"
                    )
                )

            else:

                data = request.form.to_dict()


        response_body, status_code = (
            handle_chatbot_request(data)
        )


        return jsonify(
            response_body
        ), status_code


    except Exception as e:

        print(
            "❌ ERROR:",
            str(e)
        )


        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500


# ==============================
# RUN SERVER
# ==============================

if __name__ == "__main__":

    app.run(
        debug=True,
        port=5000
    )