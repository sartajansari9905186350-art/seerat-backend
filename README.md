# SEERAT — Production-Ready Admin Panel & Backend

Production-ready Administrative & Moderation Backend for **SEERAT** (Islamic Social & Reels Platform).

---

## 📁 Architecture Overview

```
IslamicApp/
├── admin/                         # Frontend Web Admin Dashboard
│   ├── index.html                 # Main Admin Portal Layout & Modals (No hardcoded credentials)
│   ├── css/                       # Design System (Emerald #064E3B, Slate, Cards, Charts)
│   │   ├── variables.css
│   │   ├── layout.css
│   │   ├── components.css
│   │   └── charts.css
│   └── js/                        # Modular Frontend Controllers
│       ├── api.js                 # Centralized API Client (JWT Bearer Token handling)
│       ├── auth.js                # Authentication & Role-Based UI Gating
│       ├── dashboard.js           # Real Database Statistics & Interactive SVG Trend Charts
│       ├── reviewQueue.js         # Islamic Moderation Queue & Video Player Modal
│       ├── content.js             # Posts & Reels Management (Remove/Restore)
│       ├── users.js               # User Registry, Moderation Files, & Suspensions
│       ├── reports.js             # Safety Triage & Resolution Actions
│       ├── admins.js              # Super Admin Staff Management
│       ├── audit.js               # Immutable Audit Log Viewer
│       ├── settings.js            # Platform Config, Moderation Rules, Security Policies
│       ├── notifications.js       # Real-Time Header Alert Center
│       └── app.js                 # App Routing, Modal Services, Toast Alerts
│
└── backend/                       # Node.js + TypeScript + PostgreSQL REST API
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── database/
    │   ├── schema.sql             # Full Relational Schema
    │   ├── migrate.ts             # Atomic Transaction Migration Runner
    │   └── seed.ts                # Development-Only Seed Runner
    └── src/
        ├── config/                # Environment & PostgreSQL Connection Pool
        ├── models/                # TypeScript Types & Domain Interfaces
        ├── validators/            # Zod Input Validation Schemas
        ├── repositories/          # Data Access Layer
        ├── services/              # Business Logic & Database Transactions
        ├── controllers/           # HTTP Request Handlers
        ├── middleware/            # Auth RBAC, Rate Limiting, Error Handling
        ├── routes/                # Express Route Declarations
        ├── utils/                 # Response Formatter, Logger, Media Storage
        ├── app.ts                 # Express Application
        └── server.ts              # Server Bootstrap
```

---

## 🚀 Setup & Execution Guide

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **PostgreSQL** (v14 or higher)

### 2. Environment Configuration
Navigate to the backend directory and create `.env` from `.env.example`:
```bash
cd IslamicApp/backend
cp .env.example .env
```

Edit `.env` to configure your PostgreSQL credentials and JWT secret:
```env
PORT=5000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/seerat_db
JWT_SECRET=your_super_secret_jwt_key_2026_seerat
CORS_ORIGIN=*
```

### 3. Install Dependencies
```bash
cd IslamicApp/backend
npm install
```

### 4. Run PostgreSQL Migrations
Execute the atomic database migration to create all tables, indexes, and constraints:
```bash
npm run migrate
```

### 5. Seed Initial Data (Development Only)
Seed initial administrators, Islamic creators, sample reels, posts, and audit records:
```bash
npm run seed
```

> **Initial Seeded Staff Accounts:**
> - **Super Administrator**: `admin@seerat.app` (Password: `Admin@Seerat2026!`)
> - **Content Moderator**: `moderator@seerat.app` (Password: `Mod@Seerat2026!`)

### 6. Start the Backend API
```bash
# Development (TypeScript execution via ts-node)
npm run dev

# Production (Compile and run)
npm run build
npm start
```

Backend will be accessible at `http://localhost:5000` (Health check: `http://localhost:5000/api/health`).

### 7. Launch the Admin Panel Frontend
Open `IslamicApp/admin/index.html` in your web browser, or serve it via any static web server:
```bash
# Example using Python http.server
cd IslamicApp/admin
python -m http.server 8080
```
Then visit `http://localhost:8080` in your browser.

---

## 🔒 Security & RBAC Policies

| Feature / Action | SUPER_ADMIN | MODERATOR |
| :--- | :---: | :---: |
| **Executive Dashboard & KPIs** | ✅ | ✅ |
| **Review Queue & Approvals/Rejections** | ✅ | ✅ |
| **Content Management (Remove/Restore)** | ✅ | ✅ |
| **Users Registry & Suspensions** | ✅ | ✅ |
| **Community Reports Triage** | ✅ | ✅ |
| **Audit Logs Viewer** | ✅ | ✅ |
| **Staff Management (Add/Delete Admins)** | ✅ | ❌ |
| **Platform Settings & Security Policies** | ✅ | ❌ |

---

## 📱 Mobile App Preservation Notice
The SEERAT Android Mobile Application in `IslamicApp/android/` remains **100% untouched and intact**.
