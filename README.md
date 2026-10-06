# Still — Image URL Studio

A small self-hosted image uploader. It stores supported image files on the server and returns direct URLs served by that same server. It does not use eBay, a third-party image host, or synthetic URL results.

## Run locally

Requires Node.js 20.6 or newer. No package installation is needed.

```powershell
Copy-Item .env.example .env
npm start
```

Open http://127.0.0.1:4173. Images are stored in `image-store/`; keep that directory backed up if the links matter.

## Public URLs

Localhost URLs only work on the computer running the app. To make image links work outside your network, run this server on a host with persistent disk and HTTPS, expose it through a reverse proxy, and set `PUBLIC_BASE_URL` to that public HTTPS origin. Set `HOST=0.0.0.0` only behind a trusted reverse proxy or firewall. Ensure the storage volume persists across restarts. This server is designed for a single trusted operator and does not include user accounts or upload quotas; do not expose the upload endpoint publicly without adding authentication and abuse protection.

Node loads `.env` via the start command; the environment variables also work with your hosting platform's settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address to bind |
| `PORT` | `4173` | HTTP port |
| `PUBLIC_BASE_URL` | derived from host and port | Origin embedded in generated image URLs |
| `MAX_IMAGE_BYTES` | `15728640` | Per-image size limit (15 MiB) |
| `IMAGE_DIR` | `./image-store` | Persistent image storage directory |

The browser queue supports multiple selection and folder selection, four concurrent uploads, per-file retry, SHA-256 duplicate detection within the current browser session, and CSV export with filename, URL, status, and error. CSV URLs are populated only when this server confirms a stored image.

Images are served with their detected image content type and a stable UUID path. There is no delete endpoint in this first version; remove files from the configured storage directory only when you are sure their URLs are no longer needed.
