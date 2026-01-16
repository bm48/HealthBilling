-- Mock Provider Data
-- This script inserts sample provider data for each clinic
-- Run this script after the schema and clinic data have been created
--
-- This script will:
-- 1. Check if mock providers already exist (by name and clinic)
-- 2. Only insert providers that don't already exist
-- 3. Can be safely run multiple times

DO $$
DECLARE
  clinic_rec RECORD;
  provider_counter INTEGER;
  num_providers INTEGER;
  inserted_count INTEGER;
  clinic_count INTEGER;
  table_exists BOOLEAN;
BEGIN
  -- Check if clinics table exists
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'clinics'
  ) INTO table_exists;
  
  IF NOT table_exists THEN
    RAISE EXCEPTION 'The clinics table does not exist. Please run schema.sql first to create the tables.';
  END IF;
  
  -- Check if clinics table has data
  SELECT COUNT(*) INTO clinic_count FROM clinics;
  
  IF clinic_count = 0 THEN
    RAISE EXCEPTION 'No clinics found. Please run the clinic data script (mock_clinic_data.sql) first.';
  END IF;
  
  RAISE NOTICE 'Found % clinic(s). Starting provider insertion...', clinic_count;
  
  -- For each clinic, insert 4-5 providers
  FOR clinic_rec IN SELECT id, name FROM clinics ORDER BY name
  LOOP
    provider_counter := 0;
    
    -- Determine how many providers for this clinic (4-5)
    -- Use a deterministic hash based on clinic name for consistency
    num_providers := 4 + (abs(hashtext(clinic_rec.name)) % 2);
    
    -- Insert providers one by one, checking for existence
    -- Provider 1
    IF provider_counter < num_providers THEN
      INSERT INTO providers (clinic_id, first_name, last_name, specialty, npi, email, phone, active)
      SELECT 
        clinic_rec.id,
        'John',
        'Smith',
        'Family Medicine',
        '123456789' || LPAD((abs(hashtext(clinic_rec.name || 'John' || 'Smith')) % 10000)::TEXT, 4, '0'),
        LOWER('john.smith@' || REPLACE(REPLACE(LOWER(clinic_rec.name), ' ', ''), '''', '') || '.com'),
        '(' || (200 + (abs(hashtext(clinic_rec.name || 'John')) % 800))::TEXT || ') ' || 
          (555 + (abs(hashtext(clinic_rec.name || 'Smith')) % 1000))::TEXT || '-' || 
          LPAD((abs(hashtext(clinic_rec.name || 'Family Medicine')) % 10000)::TEXT, 4, '0'),
        TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM providers p
        WHERE p.clinic_id = clinic_rec.id 
        AND p.first_name = 'John' 
        AND p.last_name = 'Smith'
      );
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      provider_counter := provider_counter + inserted_count;
    END IF;
    
    -- Provider 2
    IF provider_counter < num_providers THEN
      INSERT INTO providers (clinic_id, first_name, last_name, specialty, npi, email, phone, active)
      SELECT 
        clinic_rec.id,
        'Sarah',
        'Johnson',
        'Internal Medicine',
        '123456789' || LPAD((abs(hashtext(clinic_rec.name || 'Sarah' || 'Johnson')) % 10000)::TEXT, 4, '0'),
        LOWER('sarah.johnson@' || REPLACE(REPLACE(LOWER(clinic_rec.name), ' ', ''), '''', '') || '.com'),
        '(' || (200 + (abs(hashtext(clinic_rec.name || 'Sarah')) % 800))::TEXT || ') ' || 
          (555 + (abs(hashtext(clinic_rec.name || 'Johnson')) % 1000))::TEXT || '-' || 
          LPAD((abs(hashtext(clinic_rec.name || 'Internal Medicine')) % 10000)::TEXT, 4, '0'),
        TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM providers p
        WHERE p.clinic_id = clinic_rec.id 
        AND p.first_name = 'Sarah' 
        AND p.last_name = 'Johnson'
      );
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      provider_counter := provider_counter + inserted_count;
    END IF;
    
    -- Provider 3
    IF provider_counter < num_providers THEN
      INSERT INTO providers (clinic_id, first_name, last_name, specialty, npi, email, phone, active)
      SELECT 
        clinic_rec.id,
        'Michael',
        'Williams',
        'Cardiology',
        '123456789' || LPAD((abs(hashtext(clinic_rec.name || 'Michael' || 'Williams')) % 10000)::TEXT, 4, '0'),
        LOWER('michael.williams@' || REPLACE(REPLACE(LOWER(clinic_rec.name), ' ', ''), '''', '') || '.com'),
        '(' || (200 + (abs(hashtext(clinic_rec.name || 'Michael')) % 800))::TEXT || ') ' || 
          (555 + (abs(hashtext(clinic_rec.name || 'Williams')) % 1000))::TEXT || '-' || 
          LPAD((abs(hashtext(clinic_rec.name || 'Cardiology')) % 10000)::TEXT, 4, '0'),
        TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM providers p
        WHERE p.clinic_id = clinic_rec.id 
        AND p.first_name = 'Michael' 
        AND p.last_name = 'Williams'
      );
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      provider_counter := provider_counter + inserted_count;
    END IF;
    
    -- Provider 4
    IF provider_counter < num_providers THEN
      INSERT INTO providers (clinic_id, first_name, last_name, specialty, npi, email, phone, active)
      SELECT 
        clinic_rec.id,
        'Emily',
        'Brown',
        'Pediatrics',
        '123456789' || LPAD((abs(hashtext(clinic_rec.name || 'Emily' || 'Brown')) % 10000)::TEXT, 4, '0'),
        LOWER('emily.brown@' || REPLACE(REPLACE(LOWER(clinic_rec.name), ' ', ''), '''', '') || '.com'),
        '(' || (200 + (abs(hashtext(clinic_rec.name || 'Emily')) % 800))::TEXT || ') ' || 
          (555 + (abs(hashtext(clinic_rec.name || 'Brown')) % 1000))::TEXT || '-' || 
          LPAD((abs(hashtext(clinic_rec.name || 'Pediatrics')) % 10000)::TEXT, 4, '0'),
        TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM providers p
        WHERE p.clinic_id = clinic_rec.id 
        AND p.first_name = 'Emily' 
        AND p.last_name = 'Brown'
      );
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      provider_counter := provider_counter + inserted_count;
    END IF;
    
    -- Provider 5
    IF provider_counter < num_providers THEN
      INSERT INTO providers (clinic_id, first_name, last_name, specialty, npi, email, phone, active)
      SELECT 
        clinic_rec.id,
        'David',
        'Jones',
        'Orthopedics',
        '123456789' || LPAD((abs(hashtext(clinic_rec.name || 'David' || 'Jones')) % 10000)::TEXT, 4, '0'),
        LOWER('david.jones@' || REPLACE(REPLACE(LOWER(clinic_rec.name), ' ', ''), '''', '') || '.com'),
        '(' || (200 + (abs(hashtext(clinic_rec.name || 'David')) % 800))::TEXT || ') ' || 
          (555 + (abs(hashtext(clinic_rec.name || 'Jones')) % 1000))::TEXT || '-' || 
          LPAD((abs(hashtext(clinic_rec.name || 'Orthopedics')) % 10000)::TEXT, 4, '0'),
        TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM providers p
        WHERE p.clinic_id = clinic_rec.id 
        AND p.first_name = 'David' 
        AND p.last_name = 'Jones'
      );
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      provider_counter := provider_counter + inserted_count;
    END IF;
    
    RAISE NOTICE 'Inserted % providers for clinic: %', provider_counter, clinic_rec.name;
  END LOOP;
  
  RAISE NOTICE 'Mock provider data insertion completed.';
END $$;
