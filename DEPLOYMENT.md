# SEERAT Backend — Render & Supabase Deployment Guide

This guide provides step-by-step instructions for deploying the **SEERAT** Node.js + TypeScript + Express backend to **Render** connected to a **Supabase PostgreSQL** database.

---

## 1. Prerequisites
- A [GitHub](https://github.com/) account with the backend code pushed to a new repository.
- A [Render](https://render.com/) account.
- A [Supabase](https://supabase.com/) account (or any hosted PostgreSQL instance).

---

## 2. Supabase PostgreSQL Setup
1. Log in to [Supabase](https://supabase.com/) and create a new project (e.g. `seerat-db`).
2. Go to **Project Settings** -> **Database**.
3. Under **Connection string**, select **Node.js** (or **URI**).
4. Copy the connection string. It will look like:
   ```text
   postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
   ```
   *(Ensure you replace `[YOUR-PASSWORD]` with your actual Supabase database password).*

---

## 3. Render Web Service Deployment

1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository containing the SEERAT backend.
4. Configure the service settings:
   - **Name:** `seerat-backend`
   - **Region:** Choose the region closest to your Supabase database (e.g., Frankfurt, Singapore, Oregon).
   - **Branch:** `main`
   - **Root Directory:** Leave empty if the repository root is the backend, or specify the subfolder path if monorepo.
   - **Runtime:** `Node`
   - **Build Command:**
     ```bash
     npm install && npm run build
     ```
   - **Start Command:**
     ```bash
     npm start
     ```

---

## 4. Required Environment Variables in Render

In your Render Web Service dashboard, go to the **Environment** tab and add the following variables:

| Variable Name | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `NODE_ENV` | Production environment flag | `production` |
| `PORT` | Web server port (Render assigns dynamically) | `10000` (Render defaults to 10000 or `$PORT`) |
| `DATABASE_URL` | Supabase PostgreSQL connection string | `postgresql://postgres.[REF]:[PASS]@[HOST]:[PORT]/postgres?sslmode=require` |
| `JWT_SECRET` | Strong secret for signing tokens (min 32 chars) | `[GENERATE_A_RANDOM_64_CHAR_STRING]` |
| `JWT_EXPIRES_IN` | Standard access token duration | `12h` |
| `JWT_REMEMBER_EXPIRES_IN` | Remember-me session duration | `30d` |
| `CORS_ORIGIN` | Allowed frontends | `*` (or comma-separated list of domains) |
| `STORAGE_PROVIDER` | Media storage driver | `LOCAL` |
| `CDN_BASE_URL` | Media CDN base URL | `https://cdn.seerat.app` |
| `MAX_FILE_SIZE_MB` | Upload file limit in MB | `50` |
| `ADMIN_INITIAL_PASSWORD` | Initial super admin seed password | `[YOUR_SECURE_INITIAL_PASSWORD]` |

> [!CAUTION]
> Never commit real passwords or `DATABASE_URL` secrets to GitHub. Always set them directly in the Render dashboard.

---

## 5. Running Database Migrations

### Option A: Render Pre-Deploy Command (Recommended)
In Render -> **Settings** -> **Build & Deploy**:
- **Pre-Deploy Command:**
  ```bash
  npm run migrate
  ```
This will automatically execute the schema migration on Supabase before the server boots.

### Option B: Manual Migration Run
From your local terminal with your Supabase `DATABASE_URL` in `.env`:
```bash
npm run migrate
```
To seed baseline categories and administrator accounts:
```bash
npm run seed
```

---

## 6. Verification
Once deployed, verify the service:
- **Health Check Endpoint:**
  ```text
  GET https://your-service-name.onrender.com/api/health
  ```
  Expected Response (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "status": "healthy",
      "database": "connected"
    }
  }
  ```
- **Admin Authentication:**
  ```text
  POST https://your-service-name.onrender.com/api/admin/auth/login
  ```
- **Mobile Feed:**
  ```text
  GET https://your-service-name.onrender.com/api/feed
  ```
