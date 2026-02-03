#!/usr/bin/env python3
"""Local-only live holistic tracking demo (no server required).

Processes frames directly without WebSocket overhead.
Tracks face, pose, and hands using MediaPipe Holistic.

Usage:
    uv run python live_local.py

Controls:
    q - Quit
    f - Toggle face mesh
    p - Toggle pose skeleton
    h - Toggle hand landmarks
    d - Toggle poker dashboard
    s - Save screenshot
"""

import argparse
import time

import cv2
import numpy as np

from facial_analysis import HolisticProcessor, PokerDashboard, ProcessorConfig
from pipeline import CaptureConfig, WebcamCapture


def main():
    parser = argparse.ArgumentParser(description="Local holistic tracking demo")
    parser.add_argument("-c", "--camera", type=int, default=0, help="Camera device ID")
    parser.add_argument("--width", type=int, default=640, help="Frame width")
    parser.add_argument("--height", type=int, default=480, help="Frame height")
    parser.add_argument(
        "--complexity", type=int, default=1, choices=[0, 1, 2], help="Model complexity"
    )
    args = parser.parse_args()

    capture_config = CaptureConfig(
        device_id=args.camera,
        width=args.width,
        height=args.height,
        fps=30,
    )
    processor_config = ProcessorConfig(
        model_complexity=args.complexity,
        refine_face_landmarks=True,
    )

    draw_face = True
    draw_pose = True
    draw_hands = True
    show_poker_dashboard = True
    frame_count = 0
    start_time = time.time()

    poker_dashboard = PokerDashboard()

    print("Starting holistic tracking demo...")
    print("Controls:")
    print("  q - Quit")
    print("  f - Toggle face mesh")
    print("  p - Toggle pose skeleton")
    print("  h - Toggle hand landmarks")
    print("  d - Toggle poker dashboard")
    print("  s - Save screenshot")
    print("-" * 50)

    with WebcamCapture(capture_config) as camera:
        with HolisticProcessor(processor_config) as processor:
            print(f"Camera: {camera.resolution[0]}x{camera.resolution[1]}")

            while True:
                frame_start = time.perf_counter()

                # Capture
                frame = camera.read_frame()
                if frame is None:
                    print("Failed to read frame")
                    break

                # Process - always get visualization for side-by-side
                analysis, mesh_display = processor.process_frame_with_visualization(
                    frame,
                    draw_face=draw_face,
                    draw_pose=draw_pose,
                    draw_hands=draw_hands,
                )
                clean_display = frame.copy()

                frame_count += 1
                latency_ms = (time.perf_counter() - frame_start) * 1000
                elapsed = time.time() - start_time
                fps = frame_count / max(0.001, elapsed)

                # Draw stats on clean display (left side)
                overlay = clean_display.copy()
                cv2.rectangle(overlay, (10, 10), (200, 110), (0, 0, 0), -1)
                clean_display = cv2.addWeighted(overlay, 0.5, clean_display, 0.5, 0)

                cv2.putText(
                    clean_display,
                    f"FPS: {fps:.1f}",
                    (20, 35),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 0),
                    2,
                )
                cv2.putText(
                    clean_display,
                    f"Latency: {latency_ms:.1f}ms",
                    (20, 55),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 0),
                    2,
                )

                # Detection status
                holistic = analysis.holistic
                status_parts = []
                if holistic.face.detected:
                    status_parts.append("Face")
                if holistic.pose.detected:
                    status_parts.append("Pose")
                if holistic.left_hand.detected or holistic.right_hand.detected:
                    status_parts.append("Hands")

                cv2.putText(
                    clean_display,
                    f"Detected: {', '.join(status_parts) if status_parts else 'None'}",
                    (20, 75),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (0, 255, 0),
                    1,
                )

                # Draw toggles status
                toggles = f"F:{int(draw_face)} P:{int(draw_pose)} H:{int(draw_hands)}"
                cv2.putText(
                    clean_display,
                    toggles,
                    (20, 95),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (200, 200, 200),
                    1,
                )

                # Add label to clean display
                cv2.putText(
                    clean_display,
                    "CLEAN",
                    (clean_display.shape[1] - 80, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (255, 255, 255),
                    2,
                )

                # Add label to mesh display
                cv2.putText(
                    mesh_display,
                    "HOLISTIC",
                    (mesh_display.shape[1] - 110, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (0, 255, 255),
                    2,
                )

                # Poker Dashboard display on clean side
                if show_poker_dashboard:
                    poker_analysis = poker_dashboard.analyze(holistic)
                    status_lines = poker_dashboard.get_status_text(poker_analysis)

                    # Draw poker dashboard panel
                    panel_width = 240
                    panel_height = 30 + len(status_lines) * 22
                    panel_x = 10
                    panel_y = 120

                    # Semi-transparent background
                    overlay = clean_display.copy()
                    cv2.rectangle(
                        overlay,
                        (panel_x, panel_y),
                        (panel_x + panel_width, panel_y + panel_height),
                        (0, 0, 0),
                        -1,
                    )
                    clean_display = cv2.addWeighted(overlay, 0.6, clean_display, 0.4, 0)

                    # Title
                    cv2.putText(
                        clean_display,
                        "POKER DASHBOARD",
                        (panel_x + 10, panel_y + 22),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (0, 255, 255),
                        2,
                    )

                    # Status lines
                    for i, line in enumerate(status_lines):
                        # Color based on content
                        if "HIGH" in line:
                            color = (0, 0, 255)  # Red
                        elif "MODERATE" in line:
                            color = (0, 165, 255)  # Orange
                        elif ">" in line:
                            color = (0, 200, 255)  # Yellow-ish
                        else:
                            color = (0, 255, 0)  # Green

                        cv2.putText(
                            clean_display,
                            line,
                            (panel_x + 10, panel_y + 45 + i * 22),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.5,
                            color,
                            1,
                        )

                # Create side-by-side display (clean on left, holistic on right)
                combined = np.hstack((clean_display, mesh_display))

                cv2.imshow("Holistic Tracking - Side by Side", combined)

                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                elif key == ord("f"):
                    draw_face = not draw_face
                    print(f"Face mesh: {'ON' if draw_face else 'OFF'}")
                elif key == ord("p"):
                    draw_pose = not draw_pose
                    print(f"Pose skeleton: {'ON' if draw_pose else 'OFF'}")
                elif key == ord("h"):
                    draw_hands = not draw_hands
                    print(f"Hand landmarks: {'ON' if draw_hands else 'OFF'}")
                elif key == ord("d"):
                    show_poker_dashboard = not show_poker_dashboard
                    print(f"Poker Dashboard: {'ON' if show_poker_dashboard else 'OFF'}")
                elif key == ord("s"):
                    filename = f"screenshot_{int(time.time())}.jpg"
                    cv2.imwrite(filename, combined)
                    print(f"Saved: {filename}")

    cv2.destroyAllWindows()
    print(f"\nProcessed {frame_count} frames at {fps:.1f} FPS average")


if __name__ == "__main__":
    main()
