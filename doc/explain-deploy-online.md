# Explain Deploy Online

This app can work on your iPhone anywhere (outside home) by putting it online.

## Best free setup

Use Render free web service.

## What I already prepared

- Added `/Users/aloniter/Scenic walk/render.yaml` so Render can auto-detect how to run your app.

## What you still must do (account actions)

1. Push this project to your GitHub repo.
2. In Render, click **New +** -> **Blueprint**.
3. Connect your GitHub repo and deploy.
4. Add these environment variables in Render:
   - `GOOGLE_API_KEY`
   - `GOOGLE_MAPS_BROWSER_KEY`

After deploy, you will get an HTTPS URL like:

`https://scenic-walk-xxxx.onrender.com`

Open that URL on iPhone and share it with friends.

## Important

- Free Render sleeps after idle time, so first load can be slow.
- Keep Google API quotas and billing alerts active.
