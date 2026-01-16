-- Mock Clinic Data
-- This script inserts sample clinic data for development and testing purposes
-- Run this script after the schema has been created
--
-- This script will:
-- 1. Check if mock clinics already exist (by name)
-- 2. Only insert clinics that don't already exist
-- 3. Can be safely run multiple times

DO $$
DECLARE
  inserted_count INTEGER;
BEGIN
  -- Insert clinics that don't already exist
  INSERT INTO clinics (name, address, phone)
  SELECT 
    'Downtown Medical Center'::TEXT,
    '123 Main Street, Suite 200, New York, NY 10001'::TEXT,
    '(212) 555-0101'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Downtown Medical Center')
  
  UNION ALL
  
  SELECT 
    'Riverside Family Practice'::TEXT,
    '456 Oak Avenue, Los Angeles, CA 90001'::TEXT,
    '(310) 555-0202'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Riverside Family Practice')
  
  UNION ALL
  
  SELECT 
    'Northside Health Clinic'::TEXT,
    '789 Elm Street, Chicago, IL 60601'::TEXT,
    '(312) 555-0303'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Northside Health Clinic')
  
  UNION ALL
  
  SELECT 
    'Sunset Medical Group'::TEXT,
    '321 Pine Road, Miami, FL 33101'::TEXT,
    '(305) 555-0404'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Sunset Medical Group')
  
  UNION ALL
  
  SELECT 
    'Mountain View Healthcare'::TEXT,
    '654 Cedar Lane, Denver, CO 80201'::TEXT,
    '(303) 555-0505'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Mountain View Healthcare')
  
  UNION ALL
  
  SELECT 
    'Coastal Medical Associates'::TEXT,
    '987 Beach Boulevard, San Diego, CA 92101'::TEXT,
    '(619) 555-0606'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Coastal Medical Associates')
  
  UNION ALL
  
  SELECT 
    'Metro Health Services'::TEXT,
    '147 Park Avenue, Boston, MA 02101'::TEXT,
    '(617) 555-0707'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Metro Health Services')
  
  UNION ALL
  
  SELECT 
    'Valley Medical Center'::TEXT,
    '258 Hill Street, Phoenix, AZ 85001'::TEXT,
    '(602) 555-0808'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Valley Medical Center')
  
  UNION ALL
  
  SELECT 
    'Lakeside Family Medicine'::TEXT,
    '369 Lake Drive, Seattle, WA 98101'::TEXT,
    '(206) 555-0909'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Lakeside Family Medicine')
  
  UNION ALL
  
  SELECT 
    'Central Medical Clinic'::TEXT,
    '741 Center Street, Dallas, TX 75201'::TEXT,
    '(214) 555-1010'::TEXT
  WHERE NOT EXISTS (SELECT 1 FROM clinics WHERE name = 'Central Medical Clinic');
  
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  
  IF inserted_count > 0 THEN
    RAISE NOTICE 'Inserted % new mock clinic(s)', inserted_count;
  ELSE
    RAISE NOTICE 'All mock clinics already exist. No new clinics inserted.';
  END IF;
END $$;
