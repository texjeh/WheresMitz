# Wheresmitz

A shared map of every mitz sticker spotted in the wild. Anyone can upload a photo of a mitz;
the site reads the GPS location the camera saved in the photo and pins it on the map.

## Run it locally

```
npm install
npm start
```

Open http://localhost:3000.

## How locations work

1. **GPS from photo.** The browser and the server both read the photo's EXIF GPS tags.
   Photos taken on a phone with location services on almost always have them.
2. **Pinned by hand.** If a photo has no location (screenshots, photos sent through
   messaging apps, which strip metadata), the uploader taps the map to drop a pin.
   They can also drag the pin if the GPS is off. The map labels each sighting with its source.

iPhone HEIC photos are converted to JPEG in the browser; their GPS is read before conversion.

## Privacy

Every stored photo is re-encoded, which removes all EXIF data (camera model, serial numbers,
exact timestamp, GPS). Only the map coordinates, capture date, and what the uploader typed are kept.
Uploaders should know their pin is public.

## Moderation

Set `ADMIN_TOKEN` and delete a sighting with:

```
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://your-site/api/sightings/<id>
```

The `id` is in `data/sightings.json` and in `/api/sightings`. Uploads are limited to 30 per IP per hour.

## Configuration

| Variable      | Default  | Purpose                                   |
|---------------|----------|-------------------------------------------|
| `PORT`        | `3000`   | HTTP port                                 |
| `DATA_DIR`    | `./data` | Where `sightings.json` and photos live    |
| `ADMIN_TOKEN` | (none)   | Enables the delete endpoint               |

## Deploying

Any host that runs Node 18+ or Docker and has a **persistent disk** works (Render, Fly.io,
Railway, a small VPS). Mount the disk at `DATA_DIR`. With Docker:

```
docker build -t wheresmitz .
docker run -p 3000:3000 -v wheresmitz-data:/data -e ADMIN_TOKEN=change-me wheresmitz
```

Map tiles come from openstreetmap.org, which is fine for light traffic. If the site gets busy,
switch `TILE_URL` in `public/app.js` to a tile provider such as MapTiler or Stadia Maps.
