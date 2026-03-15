#!/bin/bash
# Render build script for ai-service
# Install system dependencies (Tesseract)
apt-get update && apt-get install -y libgl1 poppler-utils
pip install -r requirements.txt
