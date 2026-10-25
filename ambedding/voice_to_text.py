# import whisper

# # Load model
# model = whisper.load_model("base")

# # Path to your audio file
# audio_path = r"D:\hackthon3\ai\face-to-embeding\mahesh.mp3"

# # Transcribe
# # result = model.transcribe(audio_path, language="kn")
# result = model.transcribe(
#     audio_path,
#     language="kn",
#     task="transcribe",
#     temperature=0,   # reduces randomness
#     best_of=5,
#     beam_size=5
# )

# # Print results
# print("Status: success")
# print("Language:", result["language"])
# print("Transcription:", result["text"])


import os
import uuid
import whisper
import subprocess

# ==============================
# LOAD MODEL ONCE
# ==============================
print("🎤 Loading Whisper model...")
model = whisper.load_model("base")
print("✅ Whisper ready")


# ==============================
# CONVERT TO MP3
# ==============================
def convert_to_mp3(input_path):
    if input_path.lower().endswith(".mp3"):
        return input_path

    output_path = f"{uuid.uuid4()}.mp3"

    command = [
        "ffmpeg",
        "-i", input_path,
        "-vn",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "192k",
        output_path
    ]

    subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    return output_path


# ==============================
# MAIN FUNCTION
# ==============================
def transcribe_audio(file_path):
    print("present in transcribe ‼️")
    try:
        print("🔄 Checking format...")
        mp3_path = convert_to_mp3(file_path)

        print("🚀 Transcribing...")
        result = model.transcribe(
            mp3_path,
            language="kn",
            task="transcribe",
            temperature=0,
            best_of=5,
            beam_size=5
        )

        print("✅ Done")

        return result["text"]

    except Exception as e:
        print("❌ Error:", str(e))
        return None