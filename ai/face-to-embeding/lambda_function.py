import json
import os
import boto3
import numpy as np
import cv2
import requests
from deepface import DeepFace
from urllib.parse import unquote_plus

# ==============================
# ENV VARIABLES
# ==============================
QDRANT_URL = os.environ.get("QDRANT_URL")
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "faces")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET")

# ==============================
# VALIDATE ENV
# ==============================
def validate_env():
    required = ["QDRANT_URL", "WEBHOOK_URL", "WEBHOOK_SECRET"]
    for key in required:
        if not os.environ.get(key):
            raise Exception(f"Missing environment variable: {key}")

validate_env()

# ==============================
# AWS CLIENT
# ==============================
s3 = boto3.client("s3")

# ==============================
# FACE EMBEDDING
# ==============================
def get_embedding(image_bytes):
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    result = DeepFace.represent(
        img_path=img,
        model_name="ArcFace",
        enforce_detection=True
    )

    if len(result) > 1:
        raise Exception("Multiple faces detected")

    return result[0]["embedding"]

# ==============================
# QDRANT SEARCH
# ==============================
def search_qdrant(embedding):
    try:
        response = requests.post(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/search",
            json={
                "vector": embedding,
                "limit": 1
            },
            timeout=5
        )

        data = response.json()

        if "result" in data and len(data["result"]) > 0:
            top = data["result"][0]
            return top.get("score"), top.get("id")

        return None, None

    except Exception as e:
        print("Qdrant search error:", str(e))
        return None, None

# ==============================
# QDRANT UPSERT
# ==============================
def upsert_qdrant(user_id, embedding):
    try:
        requests.put(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points",
            json={
                "points": [
                    {
                        "id": user_id,
                        "vector": embedding
                    }
                ]
            },
            timeout=5
        )
    except Exception as e:
        print("Qdrant upsert error:", str(e))

# ==============================
# WEBHOOK
# ==============================
def send_webhook(payload):
    headers = {
        "Content-Type": "application/json",
        "x-webhook-secret": WEBHOOK_SECRET
    }

    try:
        requests.post(
            WEBHOOK_URL,
            json=payload,
            headers=headers,
            timeout=5
        )
    except Exception as e:
        print("Webhook error:", str(e))

# ==============================
# UTIL
# ==============================
def extract_user_id_from_key(key):
    # faces/user123_1712345678.jpg
    filename = key.split("/")[-1]
    return filename.split("_")[0]

# ==============================
# MAIN HANDLER
# ==============================
def lambda_handler(event, context):
    try:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])

        print(f"Processing file: {key}")

        user_id = extract_user_id_from_key(key)

        # ==============================
        # DOWNLOAD IMAGE
        # ==============================
        obj = s3.get_object(Bucket=bucket, Key=key)
        image_bytes = obj["Body"].read()

        # ==============================
        # GENERATE EMBEDDING
        # ==============================
        try:
            embedding = get_embedding(image_bytes)
        except Exception as e:
            send_webhook({
                "userId": user_id,
                "status": "failed",
                "error": str(e)
            })
            return {"statusCode": 400}

        # ==============================
        # DUPLICATE CHECK
        # ==============================
        similarity, matched_id = search_qdrant(embedding)

        THRESHOLD = 0.75
        is_duplicate = False

        if similarity is not None and similarity > THRESHOLD:
            is_duplicate = True
        else:
            upsert_qdrant(user_id, embedding)

        # ==============================
        # WEBHOOK RESPONSE
        # ==============================
        payload = {
            "userId": user_id,
            "status": "processed",
            "isDuplicate": is_duplicate,
            "similarity": similarity,
            "matchedUserId": matched_id
        }

        send_webhook(payload)

        # ==============================
        # OPTIONAL: DELETE IMAGE
        # ==============================
        # s3.delete_object(Bucket=bucket, Key=key)

        return {
            "statusCode": 200,
            "body": json.dumps("Processed successfully")
        }

    except Exception as e:
        print("Lambda error:", str(e))

        return {
            "statusCode": 500,
            "body": json.dumps(str(e))
        }