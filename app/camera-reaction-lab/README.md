# Camera Reaction Lab

Standalone prototype voor live camera-analyse naast de For You app.

De tool draait los van `server.js` en de live showserver. Je opent een kleine webpagina, plakt daar tijdelijk een `rtsp://` of `rtsps://` camera-feed in, en krijgt:

- live MJPEG preview met face bounding boxes;
- heuristische labels zoals `happy`, `laughing`, `neutral`, `bored`, `confused`;
- audio level, reaction en laugh meters;
- live sliders voor detectie- en audio-thresholds.

## Starten

```bash
cd app/camera-reaction-lab
python3 server.py --port 3321
```

Gebruik via SSH eventueel expliciet Homebrew Python als `python3` geen `cv2` kan importeren:

```bash
/opt/homebrew/bin/python3 server.py --port 3321
```

Open daarna:

```text
http://127.0.0.1:3321/
```

Plak de camera-feed in het formulier op de pagina en klik `Start`.

Vanaf een andere machine gebruik je bij voorkeur een SSH tunnel:

```bash
ssh -L 3321:127.0.0.1:3321 foryou-studio
```

Als remote toegang echt nodig is:

```bash
python3 server.py --host 0.0.0.0 --port 3321 --access-token '<tijdelijk-token>'
```

Open dan:

```text
http://<mac-studio-ip>:3321/?token=<tijdelijk-token>
```

Zonder `--access-token` weigert de server een non-loopback bind, tenzij je bewust `--unsafe-allow-remote` gebruikt.

## Stoppen

Stop de server met `Ctrl-C` in de terminal. Als hij als achtergrondproces draait:

```bash
kill <pid>
```

Een actieve camera-feed kun je ook vanuit de web UI stoppen met `Stop`. `Clear URL` stopt de feed en wist het inputveld in de browser.

## Dependencies

Op de Mac Studio is dit getest met Homebrew:

```bash
brew install opencv ffmpeg
```

Python moet `cv2` en `numpy` kunnen importeren. De Homebrew `opencv` package levert die Python bindings mee.

## Model

Voor betere face detection gebruikt de tool OpenCV YuNet als het modelbestand bestaat:

```text
/tmp/face_detection_yunet_2023mar.onnx
```

Zie `models/README.md` voor downloadinstructies. Zonder YuNet valt de tool terug op OpenCV Haar cascades.

## Privacy en tokens

Camera-URL's worden niet opgeslagen in repo-bestanden, config of README. De URL wordt alleen via `POST /stream/start` naar het lopende Python-proces gestuurd en daar in memory gehouden zolang de stream actief is.

Als `--access-token` of `FORYOU_CAMERA_LAB_TOKEN` is gezet, zijn de webpagina, JSON endpoints, MJPEG stream, config-updates en stream start/stop alleen bereikbaar met `?token=...`, `x-camera-lab-token` of `Authorization: Bearer ...`.

De audio-worker start FFmpeg zonder de camera-URL in de FFmpeg command line te zetten. De URL wordt via stdin aan FFmpeg doorgegeven, zodat hij niet zichtbaar hoort te zijn in `ps`.

Gebruik in docs en commits alleen placeholders, bijvoorbeeld:

```text
rtsps://192.168.1.1:7441/<stream-token>?enableSrtp
```

## Let op

De emotion/reaction labels zijn prototype-heuristieken, geen getraind emotiemodel. Ze combineren face detection, smile/eye-signalen, beweging, tijd en relatieve audio-energie. Voor show-beslissingen is dit bruikbaar als experimentele sensor, maar niet als wetenschappelijke emotieclassificatie.
