# HealthBilling Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to Project Settings > API
3. Copy your Project URL and anon/public key

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 4. Set Up Database Schema

1. In your Supabase dashboard, go to SQL Editor
2. Copy and paste the entire contents of `supabase/schema.sql`
3. Run the SQL script
4. Verify that all tables were created successfully

### 5. Create Initial Super Admin User

**Super Admin Credentials:**
- Email: `admin@amerbilling.com`
- Password: `American#2025`

**Steps to create Super Admin:**

1. **Create Auth User via Supabase Dashboard:**
   - Go to **Authentication > Users** in your Supabase dashboard
   - Click **"Add User"** > **"Create new user"**
   - Email: `admin@amerbilling.com`
   - Password: `American#2025`
   - **Auto Confirm User**: Yes (important!)
   - Click **"Create user"**
   - Copy the **User UID** that is generated

2. **Create User Profile:**
   - Go to **SQL Editor** in Supabase dashboard
   - Run the script from `supabase/create_super_admin.sql`:
   
   ```sql
   -- This script will automatically find the user and create the profile
   DO $$
   DECLARE
     admin_email TEXT := 'admin@amerbilling.com';
     admin_user_id UUID;
   BEGIN
     SELECT id INTO admin_user_id
     FROM auth.users
     WHERE email = admin_email
     LIMIT 1;
     
     IF admin_user_id IS NOT NULL THEN
       INSERT INTO users (id, email, full_name, role, clinic_ids, highlight_color)
       VALUES (
         admin_user_id,
         admin_email,
         'Super Admin',
         'super_admin',
         ARRAY[]::UUID[],
         '#dc2626'
       )
       ON CONFLICT (id) DO UPDATE SET
         role = 'super_admin',
         email = admin_email,
         full_name = 'Super Admin';
     END IF;
   END $$;
   ```

   OR if you have the User UID, you can run:
   
   ```sql
   INSERT INTO users (id, email, full_name, role, clinic_ids, highlight_color)
   VALUES (
     'YOUR_USER_ID_HERE'::UUID,
     'admin@amerbilling.com',
     'Super Admin',
     'super_admin',
     ARRAY[]::UUID[],
     '#dc2626'
   )
   ON CONFLICT (id) DO UPDATE SET
     role = 'super_admin';
   ```

3. **Verify:**
   - Try logging in with `admin@amerbilling.com` / `American#2025`
   - You should have full Super Admin access

### 6. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:5173` to see the application.

## Project Structure

```
HealthBilling/
├── src/
│   ├── components/      # Reusable UI components
│   ├── contexts/        # React contexts (Auth, etc.)
│   ├── lib/            # Utilities and Supabase client
│   ├── pages/          # Page components
│   ├── types/          # TypeScript definitions
│   ├── App.tsx         # Main app with routing
│   └── main.tsx        # Entry point
├── supabase/
│   └── schema.sql      # Database schema
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## Key Features Implemented

✅ Landing page with comprehensive images
✅ Authentication system (Login)
✅ Role-based routing and navigation
✅ Dashboard with quick actions
✅ Patient database interface
✅ Billing To-Do list
✅ Timecards with clock in/out
✅ Reports interface
✅ Admin and Super Admin settings pages
✅ Database schema with RLS policies
✅ TypeScript types for all entities

## Next Steps for Full Implementation

The following features have placeholder implementations and need full development:

1. **Provider Sheet Component**: Full spreadsheet interface with all columns (A-AE)
2. **Column Permissions**: Implement role-based column visibility and editing
3. **Month Close & Locking**: Implement column locking after month close
4. **Reporting System**: Generate actual reports with PDF export
5. **Super Admin Interface**: Full user management, billing code configuration
6. **Audit Logging**: Display and filter audit logs
7. **Patient Database**: Full CRUD operations
8. **To-Do List**: Complete with notes, status management, and claim linking

## Database Tables

- `clinics` - Clinic information
- `users` - User profiles with roles
- `patients` - Patient database
- `billing_codes` - Billing codes with colors
- `provider_sheets` - Provider schedule/billing sheets
- `todo_items` - Billing To-Do items
- `todo_notes` - Notes on To-Do items
- `timecards` - Time tracking for Billing Staff
- `audit_logs` - Complete audit trail

## Role Permissions Summary

- **Super Admin**: Full system access
- **Admin**: Full access to assigned clinics
- **View-Only Admin**: Read-only access
- **Billing Staff**: Edit billing data, manage To-Do, timecards
- **View-Only Billing**: View provider sheets only
- **Provider**: Edit own schedule (Columns A-I)
- **Office Staff**: Manage schedules and patient payments

## Troubleshooting

### Supabase Connection Issues

- Verify your `.env` file has correct credentials
- Check that your Supabase project is active
- Ensure RLS policies allow your user to access data

### Database Errors

- Make sure you've run the complete `schema.sql` script
- Check that all tables were created
- Verify RLS policies are in place

### Build Errors

- Run `npm install` to ensure all dependencies are installed
- Check Node.js version (requires 18+)
- Clear node_modules and reinstall if needed
