# HealthBilling - Healthcare Revenue Management System

A comprehensive, role-based healthcare billing and revenue tracking system built with React and Supabase.

## Features

- **Role-Based Access Control**: Granular permissions for Super Admin, Admin, Billing Staff, Providers, and Office Staff
- **Provider Schedule & Billing Sheets**: Comprehensive spreadsheet-style interface with columns A-AE
- **Patient Database**: Centralized patient management with lookup integration
- **Billing To-Do List**: Track follow-up items with custom statuses and notes
- **Accounts Receivable**: Manage late payments and adjustments
- **Timecard Management**: Track Billing Staff hours with clock in/out
- **Comprehensive Reporting**: Generate reports by provider, clinic, claim, patient, labor, and invoices
- **Month Close & Locking**: Lock critical columns after month close
- **Audit Logging**: Complete audit trail of all changes

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **Routing**: React Router v6
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- A Supabase account and project

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd HealthBilling
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` and add your Supabase credentials:
```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. Set up the database:
   - Go to your Supabase project dashboard
   - Navigate to SQL Editor
   - Run the SQL script from `supabase/schema.sql`

5. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Project Structure

```
src/
├── components/     # Reusable components
├── contexts/      # React contexts (Auth, etc.)
├── lib/          # Utilities and Supabase client
├── pages/        # Page components
├── types/        # TypeScript type definitions
└── App.tsx       # Main app component with routing
```

## User Roles

- **Super Admin**: Full system access, user management, configuration
- **Admin**: Full access to assigned clinics, AR management, month close
- **View-Only Admin**: Read-only access to all clinic data
- **Billing Staff**: Edit billing data, manage To-Do list, timecards
- **View-Only Billing**: View-only access to provider sheets
- **Provider**: Edit own schedule and billing codes (Columns A-I)
- **Office Staff**: Manage schedules and patient payments for one clinic

## Database Schema

The database includes tables for:
- Users (with role-based access)
- Clinics
- Patients
- Provider Sheets (with row data as JSONB)
- Billing Codes
- Todo Items & Notes
- Timecards
- Audit Logs

See `supabase/schema.sql` for the complete schema with RLS policies.

## Development

### Building for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## License

Proprietary - All rights reserved
