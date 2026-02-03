#!/usr/bin/env python3
"""Local-only live facial mesh demo (no server required).

Processes frames directly without WebSocket overhead.
Useful for testing and lower-latency scenarios.

Usage:
    uv run python live_local.py

Controls:
    q - Quit
    t - Toggle tesselation
    c - Toggle contours
    s - Save screenshot
"""

import argparse
import time

import cv2
import numpy as np

from facial_analysis import FaceMeshProcessor, ProcessorConfig
from pipeline import CaptureConfig, WebcamCapture


def main():
    parser = argparse.ArgumentParser(description="Local facial mesh demo (no server)")
    parser.add_argument("-c", "--camera", type=int, default=0, help="Camera device ID")
    parser.add_argument("--width", type=int, default=640, help="Frame width")
    parser.add_argument("--height", type=int, default=480, help="Frame height")
    args = parser.parse_args()

    capture_config = CaptureConfig(
        device_id=args.camera,
        width=args.width,
        height=args.height,
        fps=30,
    )
    processor_config = ProcessorConfig(max_faces=2, refine_landmarks=True)

    draw_tesselation = True
    draw_contours = True
    frame_count = 0
    start_time = time.time()

    print("Starting local facial mesh demo...")
    print("Press 'q' to quit, 't' toggle tesselation, 'c' toggle contours, 's' save screenshot")
    print("-" * 50)

    with WebcamCapture(capture_config) as camera:
        with FaceMeshProcessor(processor_config) as processor:
            print(f"Camera: {camera.resolution[0]}x{camera.resolution[1]}")

            while True:
                frame_start = time.perf_counter()

                # Capture
                frame = camera.read_frame()
                if frame is None:
                    print("Failed to read frame")
                    break

                # Process
                if draw_tesselation or draw_contours:
                    analysis, display = processor.process_frame_with_visualization(
                        frame,
                        draw_tesselation=draw_tesselation,
                        draw_contours=draw_contours,
                    )
                else:
                    analysis = processor.process_frame(frame)
                    display = frame.copy()

                frame_count += 1
                latency_ms = (time.perf_counter() - frame_start) * 1000
                elapsed = time.time() - start_time
                fps = frame_count / max(0.001, elapsed)

                # Draw stats
                overlay = display.copy()
                cv2.rectangle(overlay, (10, 10), (200, 90), (0, 0, 0), -1)
                display = cv2.addWeighted(overlay, 0.5, display, 0.5, 0)

                cv2.putText(display, f"FPS: {fps:.1f}", (20, 35),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                cv2.putText(display, f"Latency: {latency_ms:.1f}ms", (20, 55),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                cv2.putText(display, f"Faces: {len(analysis.faces)}", (20, 75),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

                # Face count indicator
                if analysis.faces:
                    for face in analysis.faces:
                        key_lm = processor.get_key_landmarks(face)
                        if "nose_tip" in key_lm:
                            nose = key_lm["nose_tip"]
                            x = int(nose.x * display.shape[1])
                            y = int(nose.y * display.shape[0])
                            cv2.circle(display, (x, y), 5, (0, 0, 255), -1)

                cv2.imshow("Facial Mesh - Local", display)

                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                elif key == ord("t"):
                    draw_tesselation = not draw_tesselation
                    print(f"Tesselation: {'ON' if draw_tesselation else 'OFF'}")
                elif key == ord("c"):
                    draw_contours = not draw_contours
                    print(f"Contours: {'ON' if draw_contours else 'OFF'}")
                elif key == ord("s"):
                    filename = f"screenshot_{int(time.time())}.jpg"
                    cv2.imwrite(filename, display)
                    print(f"Saved: {filename}")

    cv2.destroyAllWindows()
    print(f"\nProcessed {frame_count} frames at {fps:.1f} FPS average")


if __name__ == "__main__":
    main()
