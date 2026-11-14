# Keep the backend awake (free uptime monitor)

Render's free web service sleeps after 15 minutes without visitors, and waking it takes 30–60 seconds plus the
service's own start-up (about 19 s at Render's 0.1 CPU). A free uptime monitor that calls the backend every few
minutes stops it from sleeping, so teachers and interviewers never wait.

## What to monitor

| Setting | Value |
| --- | --- |
| Service | [UptimeRobot](https://uptimerobot.com), free plan |
| Monitor type | HTTP(s) |
| URL | `https://skyquerychat-api.onrender.com/api/health` |
| Interval | every 5 minutes (10 minutes also works: both are under Render's 15-minute sleep timer) |

`/api/health` is very light: it reads no data and never calls the AI, so the pings cost nothing from the AI quota and
nothing from the visitor rate limits.

## Steps

1. Go to <https://uptimerobot.com> and create a free account (email and password, then confirm the email).
2. On the dashboard, click **New monitor** (or **+ Add New Monitor**).
3. Monitor type: **HTTP(s)**.
4. Friendly name: `SkyQueryChat API`.
5. URL: `https://skyquerychat-api.onrender.com/api/health`
6. Monitoring interval: **5 minutes** (the free plan's shortest).
7. Alert contacts: tick your email if you want a message when the API is down (optional).
8. Click **Create monitor**. Within a few minutes the monitor should show **Up**.

You do not need to monitor the Vercel frontend: Vercel never sleeps.

## Does this fit the free plan?

Yes. Render gives **750 free instance hours per workspace per month**. One service kept awake all month uses at most
24 hours × 31 days = **744 hours**, which fits. Keep only this one Render service awake: a second always-on free
service in the same workspace would go over 750 hours.

## Good to know

- Right after a deploy (for example the daily data refresh), `/api/health` answers `503` with `"status": "starting"`
  for about 15–20 seconds while the data loads. UptimeRobot may record one short "down" blip then; that is expected.
- The site also wakes the backend itself: every page sends an early `/api/health` ping from the page `<head>` before
  the app's JavaScript has loaded.
