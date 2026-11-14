import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read from process.env or fallback to local .env file
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
      if (match) {
        connectionString = match[1].trim().replace(/^["']|["']$/g, "");
        break;
      }
    }
  }
}

if (!connectionString) {
  console.error("Error: DATABASE_URL environment variable is not configured. Please set DATABASE_URL or define it in your .env file.");
  process.exit(1);
}

const sql = neon(connectionString);

async function setup() {
  console.log("====================================================================");
  console.log("   EGS INDIA - Neon PostgreSQL Database Initialization & Migration  ");
  console.log("====================================================================");
  console.log("Connecting to Neon database endpoint...");

  try {
    const health = await sql`SELECT NOW() as now, version() as version;`;
    console.log("✓ Connected successfully to Neon!");
    console.log("  PostgreSQL Version:", health[0].version.split(",")[0]);
    console.log("  Server Timestamp:  ", health[0].now);
    console.log("--------------------------------------------------------------------");

    // 1. Read and apply schema.sql
    console.log("Applying database schema from src/db/schema.sql...");
    const schemaPath = path.join(__dirname, "..", "src", "db", "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf-8");

function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let inDollarQuote = false;
  let dollarTag = "";

  const lines = sqlText.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inDollarQuote && (trimmed.startsWith("--") || trimmed === "")) {
      continue;
    }

    const dollarMatches = line.match(/\$\$|\$[a-zA-Z0-9_]*\$/g);
    if (dollarMatches) {
      for (const m of dollarMatches) {
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = m;
        } else if (m === dollarTag) {
          inDollarQuote = false;
          dollarTag = "";
        }
      }
    }

    current += line + "\n";

    if (!inDollarQuote && trimmed.endsWith(";")) {
      const stmt = current.trim();
      if (stmt.length > 0 && !stmt.startsWith("--")) {
        statements.push(stmt);
      }
      current = "";
    }
  }

  if (current.trim().length > 0) {
    statements.push(current.trim());
  }

  return statements;
}

    // Execute schema SQL DDL statement by statement
    const statements = splitSqlStatements(schemaSql);
    console.log(`Executing ${statements.length} schema DDL statements...`);
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await sql.query(stmt);
      } catch (stmtErr) {
        console.error(`Error executing statement ${i + 1}:`, stmt);
        throw stmtErr;
      }
    }
    console.log("✓ All tables, triggers, indexes, and views created successfully!");

    // 2. Seed Regional Hubs
    console.log("Seeding regional service hubs...");
    const hubs = [
      { id: "hub-kollam", name: "Kollam (HQ)", tag: "Headquarters", coverage: "Kollam Town, Kottarakkara, Karunagappally, Paravur", is_hq: true, lat: 8.8932, lon: 76.6141 },
      { id: "hub-tvm", name: "Thiruvananthapuram", tag: "Capital Region Hub", coverage: "Trivandrum City, Technopark, Kazhakkoottam, Kovalam", is_hq: false, lat: 8.5241, lon: 76.9366 },
      { id: "hub-ekm", name: "Ernakulam (Cochin)", tag: "Commercial Metro Hub", coverage: "Kochi City, Kakkanad, InfoPark, Aluva, Edapally", is_hq: false, lat: 9.9816, lon: 76.2999 },
      { id: "hub-tsr", name: "Thrissur", tag: "Cultural Capital Hub", coverage: "Thrissur City, Ollur, Ayyanthole, Guruvayur Highway", is_hq: false, lat: 10.5276, lon: 76.2144 },
      { id: "hub-alp", name: "Alappuzha", tag: "Coastal Service Hub", coverage: "Alappuzha Town, Cherthala, Ambalappuzha, Kayamkulam", is_hq: false, lat: 9.4981, lon: 76.3388 },
      { id: "hub-ktm", name: "Kottayam", tag: "Central Travancore Hub", coverage: "Kottayam Town, Kanjikuzhy, Changanassery, Pala", is_hq: false, lat: 9.5916, lon: 76.5222 },
      { id: "hub-clt", name: "Kozhikode", tag: "Malabar Regional Hub", coverage: "Calicut City, Mavoor Road, Cyberpark, Palayam", is_hq: false, lat: 11.2588, lon: 75.7804 },
      { id: "hub-blr", name: "Bangalore", tag: "Karnataka Commercial Hub", coverage: "Electronic City, Whitefield, Koramangala, Indiranagar", is_hq: false, lat: 12.9716, lon: 77.5946 },
      { id: "hub-maa", name: "Chennai", tag: "Tamil Nadu Hub", coverage: "OMR, Velachery, Tambaram, Anna Nagar, T. Nagar", is_hq: false, lat: 13.0827, lon: 80.2707 },
    ];

    for (const h of hubs) {
      await sql`
        INSERT INTO regional_hubs (id, name, tag, coverage, is_hq, latitude, longitude)
        VALUES (${h.id}, ${h.name}, ${h.tag}, ${h.coverage}, ${h.is_hq}, ${h.lat}, ${h.lon})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          tag = EXCLUDED.tag,
          coverage = EXCLUDED.coverage,
          is_hq = EXCLUDED.is_hq,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude;
      `;
    }
    console.log(`✓ Seeded ${hubs.length} regional service hubs.`);

    // 3. Seed Technicians
    console.log("Seeding technicians data...");
    const technicians = [
      { id: "tech-1", name: "Arun Kumar", phone: "+91 98950 12345", city: "Kollam", rating: 4.9, experience_years: 8, specialization: ["Jet Cleaning", "PCB Repair", "Gas Refill"], status: "available", active_jobs_count: 1 },
      { id: "tech-2", name: "Vipin Das", phone: "+91 85890 54321", city: "Thiruvananthapuram", rating: 4.8, experience_years: 6, specialization: ["Installation", "Ductable AC", "Inverter AC"], status: "on_job", active_jobs_count: 2 },
      { id: "tech-3", name: "Muhammed Shafi", phone: "+91 85899 98765", city: "Ernakulam", rating: 4.9, experience_years: 10, specialization: ["VRV/VRF Systems", "Commercial Chillers", "Compressor Replacement"], status: "available", active_jobs_count: 0 },
      { id: "tech-4", name: "Sujith Nair", phone: "+91 99959 11223", city: "Thrissur", rating: 4.7, experience_years: 5, specialization: ["AMC Maintenance", "Foam Wash", "Leak Detection"], status: "available", active_jobs_count: 1 },
      { id: "tech-5", name: "Karthik R.", phone: "+91 98958 33445", city: "Chennai", rating: 4.9, experience_years: 7, specialization: ["Split AC", "Multi-brand Repair", "Emergency Fix"], status: "on_job", active_jobs_count: 3 },
    ];

    for (const t of technicians) {
      await sql`
        INSERT INTO technicians (id, name, phone, city, rating, experience_years, specialization, status, active_jobs_count)
        VALUES (${t.id}, ${t.name}, ${t.phone}, ${t.city}, ${t.rating}, ${t.experience_years}, ${t.specialization}, ${t.status}, ${t.active_jobs_count})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          city = EXCLUDED.city,
          rating = EXCLUDED.rating,
          experience_years = EXCLUDED.experience_years,
          specialization = EXCLUDED.specialization,
          status = EXCLUDED.status,
          active_jobs_count = EXCLUDED.active_jobs_count;
      `;
    }
    console.log(`✓ Seeded ${technicians.length} certified technicians.`);

    // 4. Seed Customers
    console.log("Seeding sample customers...");
    const customers = [
      { id: "CUST-2026-101", name: "Dr. Ananya Varma", mobile: "9847123456", whatsapp: "9847123456", email: "dr.ananya@gmail.com", address: "Villa 12, Kowdiar Gardens, Kowdiar", pin: "695003", location: "Thiruvananthapuram", previous_services: ["Deep Jet Clean", "Gas Top-Up"], ac_type: "Split AC", number_of_units: "4", amc_status: "Active", amc_plan: "Comprehensive Care", total_spend: 14500, last_booking_date: "2026-10-24" },
      { id: "CUST-2026-102", name: "Mathew Joseph", mobile: "9447654321", whatsapp: "9447654321", email: "mathew.j@outlook.com", address: "Flat 4B, Skyline Imperial, Marine Drive", pin: "682031", location: "Ernakulam", previous_services: ["Installation", "Pre-Summer Service"], ac_type: "Split AC", number_of_units: "3", amc_status: "Active", amc_plan: "Residential Saver", total_spend: 8900, last_booking_date: "2026-10-18" },
      { id: "CUST-2026-103", name: "Rahul Sreedhar", mobile: "9746112233", whatsapp: "9746112233", email: "rahul.s@tcs.com", address: "Prasanthi Nagar, Near Collectorate", pin: "691001", location: "Kollam", previous_services: ["Water Leakage Fix", "Foam Jet Wash"], ac_type: "Split AC", number_of_units: "2", amc_status: "Expiring Soon", amc_plan: "Residential Saver", total_spend: 4600, last_booking_date: "2026-10-12" },
      { id: "CUST-2026-104", name: "Lekshmi Menon", mobile: "9895001122", whatsapp: "9895001122", email: "lekshmi.menon@gmail.com", address: "Surabhi, Round South", pin: "680001", location: "Thrissur", previous_services: ["PCB Board Repair"], ac_type: "Inverter AC", number_of_units: "1", amc_status: "None", total_spend: 3200, last_booking_date: "2026-10-05" },
    ];

    for (const c of customers) {
      await sql`
        INSERT INTO customers (id, name, mobile, whatsapp, email, address, pin, location, previous_services, ac_type, number_of_units, amc_status, amc_plan, total_spend, last_booking_date)
        VALUES (${c.id}, ${c.name}, ${c.mobile}, ${c.whatsapp}, ${c.email}, ${c.address}, ${c.pin}, ${c.location}, ${c.previous_services}, ${c.ac_type}, ${c.number_of_units}, ${c.amc_status}, ${c.amc_plan || null}, ${c.total_spend}, ${c.last_booking_date})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          mobile = EXCLUDED.mobile,
          whatsapp = EXCLUDED.whatsapp,
          email = EXCLUDED.email,
          address = EXCLUDED.address,
          pin = EXCLUDED.pin,
          location = EXCLUDED.location,
          amc_status = EXCLUDED.amc_status,
          total_spend = EXCLUDED.total_spend;
      `;
    }
    console.log(`✓ Seeded ${customers.length} customer profiles.`);

    // 5. Seed Bookings
    console.log("Seeding sample bookings...");
    const bookings = [
      {
        id: "EGS-2026-1088",
        status: "CONFIRMED",
        service_category: "ac-service",
        service_name: "❄️ Full Body Service",
        sub_service: "Deep Power Jet Cleaning & Anti-Bacterial Foam Wash",
        ac_type: "Split AC",
        ac_brand: "Daikin",
        unit_count: "2",
        issue_description: "Less cooling in master bedroom and bad odor from blower",
        preferred_date: "Today (Express 90-Min Slot)",
        preferred_slot: "Morning (9:00 AM - 12:00 PM)",
        customer_name: "Dr. Ananya Varma",
        phone: "9847123456",
        whatsapp_number: "9847123456",
        house_building: "Villa 12, Kowdiar Gardens",
        area: "Kowdiar",
        address: "Villa 12, Kowdiar Gardens, Kowdiar, Thiruvananthapuram",
        landmark: "Near Kowdiar Palace",
        city: "Thiruvananthapuram",
        pincode: "695003",
        latitude: 8.5241,
        longitude: 76.9366,
        estimated_amount: 1598.00,
        assigned_technician_id: "tech-2",
        assigned_technician_name: "Vipin Das",
      },
      {
        id: "EGS-2026-1089",
        status: "ASSIGNED",
        service_category: "ac-repair",
        service_name: "🔧 AC Repair",
        sub_service: "Water Leakage & Drainage Block",
        ac_type: "Split AC",
        ac_brand: "Voltas",
        unit_count: "1",
        issue_description: "Water continuously dripping from indoor unit onto sofa",
        preferred_date: "Today (Express 90-Min Slot)",
        preferred_slot: "Emergency Now (Within 90 Mins)",
        customer_name: "Mathew Joseph",
        phone: "9447654321",
        whatsapp_number: "9447654321",
        house_building: "Flat 4B, Skyline Imperial",
        area: "Marine Drive",
        address: "Flat 4B, Skyline Imperial, Marine Drive, Ernakulam",
        landmark: "Opposite Rainbow Bridge",
        city: "Ernakulam",
        pincode: "682031",
        latitude: 9.9816,
        longitude: 76.2999,
        estimated_amount: 649.00,
        assigned_technician_id: "tech-3",
        assigned_technician_name: "Muhammed Shafi",
      },
      {
        id: "EGS-2026-1090",
        status: "NEW",
        service_category: "gas-charging",
        service_name: "💨 Gas Charging",
        sub_service: "Full Gas Refill (R32 / R410A / R22)",
        ac_type: "Split AC",
        ac_brand: "LG",
        unit_count: "1",
        issue_description: "Compressor runs but ice formation on copper tube, zero cooling",
        preferred_date: "Tomorrow",
        preferred_slot: "Afternoon (12:00 PM - 3:00 PM)",
        customer_name: "Rahul Sreedhar",
        phone: "9746112233",
        whatsapp_number: "9746112233",
        house_building: "Prasanthi Nagar 42",
        area: "Civil Station",
        address: "Prasanthi Nagar 42, Civil Station, Kollam",
        landmark: "Behind District Collectorate",
        city: "Kollam",
        pincode: "691001",
        latitude: 8.8932,
        longitude: 76.6141,
        estimated_amount: 1799.00,
        assigned_technician_id: "tech-1",
        assigned_technician_name: "Arun Kumar",
      },
    ];

    for (const b of bookings) {
      await sql`
        INSERT INTO bookings (
          id, status, service_category, service_name, sub_service, ac_type, ac_brand,
          unit_count, issue_description, preferred_date, preferred_slot, customer_name,
          phone, whatsapp_number, house_building, area, address, landmark, city,
          pincode, latitude, longitude, estimated_amount, assigned_technician_id, assigned_technician_name
        ) VALUES (
          ${b.id}, ${b.status}, ${b.service_category}, ${b.service_name}, ${b.sub_service},
          ${b.ac_type}, ${b.ac_brand}, ${b.unit_count}, ${b.issue_description}, ${b.preferred_date},
          ${b.preferred_slot}, ${b.customer_name}, ${b.phone}, ${b.whatsapp_number},
          ${b.house_building}, ${b.area}, ${b.address}, ${b.landmark}, ${b.city},
          ${b.pincode}, ${b.latitude}, ${b.longitude}, ${b.estimated_amount},
          ${b.assigned_technician_id}, ${b.assigned_technician_name}
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          service_name = EXCLUDED.service_name,
          estimated_amount = EXCLUDED.estimated_amount,
          assigned_technician_id = EXCLUDED.assigned_technician_id;
      `;
    }
    console.log(`✓ Seeded ${bookings.length} service bookings.`);

    // 6. Seed AMC Contracts
    console.log("Seeding AMC contracts...");
    const amcList = [
      {
        id: "amc-1",
        contract_no: "AMC-2026-104",
        amc_start_date: "2026-01-15",
        amc_end_date: "2027-01-14",
        customer_id: "CUST-2026-101",
        customer_name: "Dr. Ananya Varma",
        phone: "9847123456",
        whatsapp: "9847123456",
        email: "dr.ananya@gmail.com",
        city: "Thiruvananthapuram",
        address: "Villa 12, Kowdiar Gardens, Kowdiar",
        number_of_units: 4,
        service_frequency: "Quarterly (4 Services/Year)",
        last_service_date: "2026-07-20",
        last_service_details: "Deep Hydro Jet Clean & Gas Diagnostic",
        last_service_technician: "Vipin Das",
        next_service_date: "2026-10-30",
        next_service_slot: "Morning Slot (9:00 AM - 12:00 PM)",
        next_service_status: "scheduled",
        plan_name: "Comprehensive Care",
        services_included: 4,
        services_completed: 2,
        status: "active",
        amount: 8500.00,
        renewal_discount_percent: 15,
      },
      {
        id: "amc-2",
        contract_no: "AMC-2025-089",
        amc_start_date: "2025-11-10",
        amc_end_date: "2026-11-09",
        customer_id: "CUST-2026-103",
        customer_name: "Rahul Sreedhar",
        phone: "9746112233",
        whatsapp: "9746112233",
        email: "rahul.s@tcs.com",
        city: "Kollam",
        address: "Prasanthi Nagar 42, Civil Station",
        number_of_units: 2,
        service_frequency: "Quarterly (4 Services/Year)",
        last_service_date: "2026-08-15",
        last_service_details: "Pre-Monsoon Filter & Condenser Flush",
        last_service_technician: "Arun Kumar",
        next_service_date: "2026-11-05",
        next_service_slot: "Afternoon (1:00 PM - 4:00 PM)",
        next_service_status: "scheduled",
        plan_name: "Residential Saver",
        services_included: 4,
        services_completed: 3,
        status: "expiring_soon",
        amount: 3000.00,
        renewal_discount_percent: 10,
      },
    ];

    for (const a of amcList) {
      await sql`
        INSERT INTO amc_contracts (
          id, contract_no, amc_start_date, amc_end_date, customer_id, customer_name,
          phone, whatsapp, email, city, address, number_of_units, service_frequency,
          last_service_date, last_service_details, last_service_technician, next_service_date,
          next_service_slot, next_service_status, plan_name, services_included, services_completed,
          status, amount, renewal_discount_percent
        ) VALUES (
          ${a.id}, ${a.contract_no}, ${a.amc_start_date}, ${a.amc_end_date}, ${a.customer_id},
          ${a.customer_name}, ${a.phone}, ${a.whatsapp}, ${a.email}, ${a.city}, ${a.address},
          ${a.number_of_units}, ${a.service_frequency}, ${a.last_service_date}, ${a.last_service_details},
          ${a.last_service_technician}, ${a.next_service_date}, ${a.next_service_slot},
          ${a.next_service_status}, ${a.plan_name}, ${a.services_included}, ${a.services_completed},
          ${a.status}, ${a.amount}, ${a.renewal_discount_percent}
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          services_completed = EXCLUDED.services_completed;
      `;
    }
    console.log(`✓ Seeded ${amcList.length} AMC contracts.`);

    // 7. Seed Payment Transactions
    console.log("Seeding sample transactions...");
    const payments = [
      {
        id: "TXN-2026-8801",
        invoice_no: "INV-2026-1088",
        booking_id: "EGS-2026-1088",
        customer_name: "Dr. Ananya Varma",
        phone: "9847123456",
        whatsapp: "9847123456",
        amount: 1598.00,
        subtotal: 1354.24,
        tax_amount: 243.76,
        payment_method: "UPI / QR Code",
        status: "PAID",
        transaction_ref: "UPI/329810481902/ICICI",
        technician_id: "tech-2",
        technician_name: "Vipin Das",
        service_name: "❄️ Full Body Service (2 Units)",
        paid_at: "2026-10-28T05:30:00Z",
      },
      {
        id: "TXN-2026-8802",
        invoice_no: "INV-2026-1089",
        booking_id: "EGS-2026-1089",
        customer_name: "Mathew Joseph",
        phone: "9447654321",
        whatsapp: "9447654321",
        amount: 649.00,
        subtotal: 550.00,
        tax_amount: 99.00,
        payment_method: "Cash on Delivery",
        status: "PAID",
        transaction_ref: "CASH-REC-1089",
        technician_id: "tech-3",
        technician_name: "Muhammed Shafi",
        service_name: "🔧 AC Repair (Water Drain Fix)",
        paid_at: "2026-10-28T09:15:00Z",
      },
    ];

    for (const p of payments) {
      await sql`
        INSERT INTO payment_transactions (
          id, invoice_no, booking_id, customer_name, phone, whatsapp,
          amount, subtotal, tax_amount, payment_method, status, transaction_ref,
          technician_id, technician_name, service_name, paid_at
        ) VALUES (
          ${p.id}, ${p.invoice_no}, ${p.booking_id}, ${p.customer_name}, ${p.phone},
          ${p.whatsapp}, ${p.amount}, ${p.subtotal}, ${p.tax_amount}, ${p.payment_method},
          ${p.status}, ${p.transaction_ref}, ${p.technician_id}, ${p.technician_name},
          ${p.service_name}, ${p.paid_at}
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          amount = EXCLUDED.amount;
      `;
    }
    console.log(`✓ Seeded ${payments.length} payment transactions.`);

    // 8. Verification & Summary
    console.log("--------------------------------------------------------------------");
    console.log("Verifying table row counts in Neon database:");
    const tableCounts = await sql`
      SELECT 'regional_hubs' AS tbl, COUNT(*) AS count FROM regional_hubs
      UNION ALL SELECT 'technicians', COUNT(*) FROM technicians
      UNION ALL SELECT 'customers', COUNT(*) FROM customers
      UNION ALL SELECT 'bookings', COUNT(*) FROM bookings
      UNION ALL SELECT 'amc_contracts', COUNT(*) FROM amc_contracts
      UNION ALL SELECT 'payment_transactions', COUNT(*) FROM payment_transactions
      UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
      UNION ALL SELECT 'contact_inquiries', COUNT(*) FROM contact_inquiries
      UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs;
    `;

    console.table(tableCounts);

    const kpis = await sql`SELECT * FROM v_dashboard_kpis;`;
    console.log("Dashboard KPIs View Check:");
    console.table(kpis);

    console.log("====================================================================");
    console.log("   DATABASE CREATED & SEEDED SUCCESSFULLY IN NEON POSTGRESQL! 🚀    ");
    console.log("====================================================================");
  } catch (error) {
    console.error("Database setup failed with error:", error);
    process.exit(1);
  }
}

setup();
