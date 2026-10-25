import os
import boto3
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

# ==============================
# LOAD ENV
# ==============================
load_dotenv()

AWS_REGION = os.getenv("AWS_REGION")
S3_BUCKET = os.getenv("S3_BUCKET")

if not S3_BUCKET:
    raise Exception("Missing S3_BUCKET")

# ==============================
# S3 CLIENT
# ==============================
s3 = boto3.client("s3", region_name=AWS_REGION)

# ==============================
# FLASK APP
# ==============================
app = Flask(__name__)

# ==============================
# UPLOAD ROUTE
# ==============================
@app.route("/upload", methods=["POST"])
def upload_image():
    try:
        file = request.files.get("file")

        if not file:
            return jsonify({"error": "file required"}), 400

        # ✅ Use original filename safely
        original_filename = secure_filename(file.filename)

        if not original_filename:
            return jsonify({"error": "invalid filename"}), 400

        file_key = original_filename  # 👈 THIS IS THE CHANGE

        # ==============================
        # OPTIONAL: Prevent overwrite
        # ==============================
        try:
            s3.head_object(Bucket=S3_BUCKET, Key=file_key)
            return jsonify({"error": "file already exists"}), 400
        except:
            pass  # file does not exist → safe to upload

        # ==============================
        # UPLOAD TO S3
        # ==============================
        s3.upload_fileobj(
            Fileobj=file,
            Bucket=S3_BUCKET,
            Key=file_key,
            ExtraArgs={"ContentType": file.content_type}
        )

        # ==============================
        # FILE URL
        # ==============================
        file_url = f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{file_key}"

        return jsonify({
            "fileKey": file_key,
            "fileUrl": file_url
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

# ==============================
# RUN SERVER
# ==============================
if __name__ == "__main__":
    app.run(debug=True, port=4000)