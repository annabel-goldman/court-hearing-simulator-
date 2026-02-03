#!/usr/bin/env python3
"""Live facial mesh demo with webcam.

Run the server first:
    uv run python main.py

Then run this demo:
    uv run python live_demo.py

Controls:
    q - Quit
    v - Toggle visualization mode
    s - Save screenshot
"""

import argparse
import asyncio
import sys
import time

import cv2
import numpy as np

from pipeline import (
    CaptureConfig,
    ClientConfig,
    FaceAnalysisClient,
    PipelineStats,
    WebcamCapture,
)


def draw_stats_overlay(frame: np.ndarray, stats: PipelineStats, latency: float) -> np.ndarray:
    """Draw statistics on the frame."""
    overlay = frame.copy()
    h, w = frame.shape[:2]

    # Semi-transparent background for stats
    cv2.rectangle(overlay, (10, 10), (250, 100), (0, 0, 0), -1)
    frame = cv2.addWeighted(overlay, 0.5, frame, 0.5, 0)

    # Stats text
    font = cv2.FONT_HERSHEY_SIMPLEX
    color = (0, 255, 0)
    cv2.putText(frame, f"FPS: {stats.fps:.1f}", (20, 35), font, 0.6, color, 2)
    cv2.putText(frame, f"Latency: {latency:.1f}ms", (20, 55), font, 0.6, color, 2)
    cv2.putText(frame, f"Faces: {stats.faces_detected}", (20, 75), font, 0.6, color, 2)
    cv2.putText(frame, f"Frames: {stats.frames_processed}", (20, 95), font, 0.6, color, 2)

    return frame


def draw_landmarks_local(frame: np.ndarray, analysis) -> np.ndarray:
    """Draw face landmarks directly on frame (without server visualization)."""
    h, w = frame.shape[:2]

    for face in analysis.faces:
        if not face.landmarks:
            continue

        # Draw key points
        for lm in face.landmarks:
            x = int(lm.x * w)
            y = int(lm.y * h)
            cv2.circle(frame, (x, y), 1, (0, 255, 0), -1)

        # Draw face oval (selected landmarks)
        oval_indices = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
                        397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
                        172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

        pts = []
        for idx in oval_indices:
            if idx < len(face.landmarks):
                lm = face.landmarks[idx]
                pts.append([int(lm.x * w), int(lm.y * h)])

        if pts:
            pts = np.array(pts, dtype=np.int32)
            cv2.polylines(frame, [pts], True, (255, 200, 0), 1)

    return frame


async def run_live_pipeline(
    camera_id: int = 0,
    server_url: str = "ws://localhost:8000/ws/video",
    use_server_visualization: bool = False,
    show_window: bool = True,
):
    """Run the live facial analysis pipeline.

    Args:
        camera_id: Webcam device ID.
        server_url: WebSocket server URL.
        use_server_visualization: Request annotated frames from server.
        show_window: Show OpenCV window with visualization.
    """
    capture_config = CaptureConfig(device_id=camera_id, width=640, height=480, fps=30)
    client_config = ClientConfig(
        server_url=server_url,
        request_visualization=use_server_visualization,
        jpeg_quality=85,
    )

    stats = PipelineStats()
    visualize_server = use_server_visualization

    print(f"Connecting to {server_url}...")
    print("Press 'q' to quit, 'v' to toggle visualization mode, 's' to save screenshot")
    print("-" * 50)

    try:
        async with FaceAnalysisClient(client_config) as client:
            with WebcamCapture(capture_config) as camera:
                print(f"Camera opened: {camera.resolution[0]}x{camera.resolution[1]} @ {camera.actual_fps:.0f}fps")

                while True:
                    # Capture frame
                    frame = camera.read_frame()
                    if frame is None:
                        print("Failed to read frame")
                        break

                    # Analyze frame
                    try:
                        result = await client.analyze_frame(frame, request_visualization=visualize_server)
                        stats.update(result)
                    except Exception as e:
                        print(f"Analysis error: {e}")
                        continue

                    # Prepare display frame
                    if visualize_server and result.annotated_frame is not None:
                        display_frame = result.annotated_frame
                    else:
                        display_frame = draw_landmarks_local(frame.copy(), result.analysis)

                    # Add stats overlay
                    display_frame = draw_stats_overlay(display_frame, stats, result.latency_ms)

                    # Show face count
                    face_count = len(result.analysis.faces)
                    if face_count > 0:
                        cv2.putText(
                            display_frame,
                            f"Detected: {face_count} face(s)",
                            (display_frame.shape[1] - 200, 30),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.6,
                            (0, 255, 0),
                            2,
                        )

                    if show_window:
                        cv2.imshow("Facial Mesh - Live", display_frame)

                        key = cv2.waitKey(1) & 0xFF
                        if key == ord("q"):
                            print("\nQuitting...")
                            break
                        elif key == ord("v"):
                            visualize_server = not visualize_server
                            mode = "server" if visualize_server else "local"
                            print(f"Switched to {mode} visualization")
                        elif key == ord("s"):
                            filename = f"screenshot_{int(time.time())}.jpg"
                            cv2.imwrite(filename, display_frame)
                            print(f"Saved: {filename}")

                    # Print periodic stats
                    if stats.frames_processed % 100 == 0:
                        print(
                            f"Processed {stats.frames_processed} frames | "
                            f"FPS: {stats.fps:.1f} | "
                            f"Avg latency: {stats.avg_latency_ms:.1f}ms"
                        )

    except ConnectionError as e:
        print(f"Connection failed: {e}")
        print("Make sure the server is running: uv run python main.py")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nInterrupted")
    finally:
        if show_window:
            cv2.destroyAllWindows()

        print("\n" + "=" * 50)
        print("Session Statistics:")
        print(f"  Total frames: {stats.frames_processed}")
        print(f"  Average FPS: {stats.fps:.1f}")
        print(f"  Average latency: {stats.avg_latency_ms:.1f}ms")
        print(f"  Total faces detected: {stats.faces_detected}")
        print("=" * 50)


def main():
    parser = argparse.ArgumentParser(description="Live facial mesh demo")
    parser.add_argument("-c", "--camera", type=int, default=0, help="Camera device ID")
    parser.add_argument(
        "-s", "--server", default="ws://localhost:8000/ws/video", help="Server WebSocket URL"
    )
    parser.add_argument(
        "-v", "--visualize", action="store_true", help="Use server-side visualization"
    )
    parser.add_argument("--headless", action="store_true", help="Run without display window")

    args = parser.parse_args()

    asyncio.run(
        run_live_pipeline(
            camera_id=args.camera,
            server_url=args.server,
            use_server_visualization=args.visualize,
            show_window=not args.headless,
        )
    )


if __name__ == "__main__":
    main()
