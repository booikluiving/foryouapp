# Models

Deze map is bedoeld voor modelnotities, niet voor geheime camera-data.

## YuNet

De lab-server gebruikt OpenCV YuNet als dit bestand bestaat:

```text
/tmp/face_detection_yunet_2023mar.onnx
```

Download op de Mac Studio:

```bash
curl -L --fail -o /tmp/face_detection_yunet_2023mar.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
```

Start de server eventueel met een ander pad:

```bash
python3 server.py --model-path /pad/naar/face_detection_yunet_2023mar.onnx
```

Commit geen camera-stream tokens of privé-opnames in deze map.
