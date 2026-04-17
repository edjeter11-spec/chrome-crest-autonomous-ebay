#!/usr/bin/env python3
"""
F1 Chrome Crest - Start Script
Starts the FastAPI backend which serves the React frontend from /dist
"""
import subprocess
import sys
import os
import time


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(base_dir, "backend")

    print("=" * 60)
    print("  F1 CHROME CREST - Autonomous eBay Sniping Platform")
    print("=" * 60)
    print()
    print("Starting FastAPI server on http://localhost:8000")
    print()

    os.chdir(backend_dir)

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"],
        cwd=backend_dir,
    )

    time.sleep(3)
    print()
    print("=" * 60)
    print("  Server running at http://localhost:8000")
    print("  API docs at    http://localhost:8000/docs")
    print("=" * 60)

    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()


if __name__ == "__main__":
    main()
