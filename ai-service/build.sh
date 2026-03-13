#!/bin/bash
# Render build script for ai-service
# Install system dependencies (Tesseract)
apt-get update && apt-get install -y tesseract-ocr tesseract-ocr-eng libgl1 poppler-utils
pip install -r requirements.txt
