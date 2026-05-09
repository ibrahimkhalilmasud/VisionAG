# VisionAG — Fabric Inventory Management System

> Version 1.0 · Node.js + SQLite · MYR & EUR dual-currency

---

## Quick Start

> **First time?** Install Node.js first — see [Prerequisites](#prerequisites) below.

1. **Double-click `START.bat`**
2. The browser opens automatically at `http://localhost:3000`
3. Log in with the default credentials below

| Role  | Username | Password   | Access Level          |
|-------|----------|------------|-----------------------|
| Admin | `admin`  | `admin123` | Full access           |
| Staff | `staff`  | `staff123` | View + add sales only |

> **Security:** Change default passwords immediately after first login (Admin → User Management).

---

## Prerequisites

| Requirement | Version  | Download                          |
|-------------|----------|-----------------------------------|
| Node.js     | 18+ LTS  | `Setup/node-v24.15.0-x64.msi`    |

**To install Node.js:**
1. Open the `Setup/` folder (one level up from VisionAG)
2. Run `node-v24.15.0-x64.msi` and follow the installer
3. Restart your computer if prompted
4. Come back here and double-click `START.bat`

---

## Features

### Inventory & Products
- Add, edit, and delete products with photo upload
- Categories: Silk · Lace · China Lace · Embroidery
- Design Number + Article Number search (dropdown)
- Real-time stock levels and low-stock alerts
- Stock value report per category

### Sales & Orders
- Create invoices with discount + tax support
- Assign orders to customers
- Track order status
- Print / export invoices as PDF

### Reporting
- Sales report by date range
- Stock report with total inventory value
- Profit & Loss overview
- Bulk download of inventory reports

### System
- Admin + Staff role management
- Multi-user (multiple employees)
- Customer database
- MYR (RM) + EUR (€) dual-currency pricing
- Mobile-responsive interface
- Database backup and restore

---

## File Structure

```
Office Stock and inventory Manager/
│
├── Setup/                          ← Node.js installer
│   └── node-v24.15.0-x64.msi
│
└── VisionAG/                       ← Application root
    ├── START.bat                   ← LAUNCH APP (double-click this)
    ├── REINSTALL.bat               ← Fix broken install / reset packages
    ├── README.md                   ← This file
    │
    ├── server.js                   ← Backend API (Express)
    ├── database.js                 ← Database schema & init (SQLite)
    ├── reload_inventory.js         ← Bulk import utility (run once, server OFF)
    ├── package.json                ← Dependencies
    │
    ├── visionag.db                 ← ALL your data lives here (back this up!)
    │
    ├── data/                       ← Import files
    │   ├── inventory_data.json     ← JSON used by reload_inventory.js
    │   └── NLK Mohan - Master Sheet [SCOTT DRAFT].xlsx
    │
    ├── backups/                    ← Automatic database backups
    │   └── visionag.db.backup_*
    │
    ├── uploads/                    ← Product photos (auto-managed)
    │
    └── public/                     ← Frontend (browser UI)
        ├── index.html              ← Main dashboard & all pages
        └── login.html              ← Login screen
```

---

## Importing Your Excel Data

### Option A — Manual Add
Go to **Products** page → click **Add Product** → fill in the form.

### Option B — Bulk Import via JSON

1. Stop the server (`Ctrl+C` in the black window, or close it)
2. Convert your Excel to the JSON format and save as `data/inventory_data.json`
3. Open a Command Prompt in the `VisionAG/` folder
4. Run: `node reload_inventory.js`
5. When done, relaunch with `START.bat`

**Required JSON fields per item:**

```json
{
  "category": "Silk",
  "brand": "BrandName",
  "design": "D001",
  "article": "A001",
  "quality": "Premium",
  "qty": 50,
  "cost_eur": 12.5,
  "cost_rm": 58.0,
  "sell_mt_rm": 75.0,
  "status": "available"
}
```

---

## Backup & Restore

### Backup
Copy the single file **`visionag.db`** to a safe location.
This file contains ALL your inventory, sales, customers, and user data.

```
Recommended: copy visionag.db to a USB drive or cloud folder weekly.
```

Automatic backups are saved in the `backups/` folder.

### Restore
1. Stop the server
2. Replace `visionag.db` with your backup copy
3. Restart with `START.bat`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `START.bat` shows "Node.js not installed" | Run `Setup/node-v24.15.0-x64.msi` and reinstall Node.js |
| App won't open in browser | Make sure the black window is still running, then go to `http://localhost:3000` manually |
| Packages broken / missing | Double-click `REINSTALL.bat` — it removes and reinstalls all packages fresh |
| Port 3000 already in use | Close any other app using port 3000, or restart your computer |
| Forgot password | Admin can reset any user password via Admin → User Management |
| Database corrupted | Restore from a backup in the `backups/` folder |

---

## Changing Passwords

1. Log in as **Admin**
2. Go to **User Management** (Admin menu)
3. Click the user → **Edit** → enter new password → **Save**

---

## Currencies

| Symbol | Currency        | Used For              |
|--------|-----------------|-----------------------|
| RM     | Malaysian Ringgit (MYR) | Local pricing |
| €      | Euro (EUR)      | Import/cost pricing   |

---

## Tech Stack

| Layer    | Technology           |
|----------|----------------------|
| Backend  | Node.js + Express    |
| Database | SQLite (better-sqlite3) |
| Frontend | HTML / CSS / JS (vanilla) |
| Charts   | Chart.js             |
| Auth     | JWT + bcrypt         |
| Photos   | Multer               |

---

*VisionAG Fabric Inventory — built for MYR + EUR dual-currency fabric businesses.*
