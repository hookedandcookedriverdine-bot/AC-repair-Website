import { neon } from "@neondatabase/serverless";
import type { Booking, Customer, Technician, BookingStatus } from "./store";

// Neon Serverless PostgreSQL Database Connection
// Environment variables are securely loaded via process.env.DATABASE_URL (Vercel / Node) 
// or import.meta.env.VITE_DATABASE_URL (Vite Client)
export const DATABASE_URL =
  (typeof process !== "undefined" && process.env?.DATABASE_URL) ||
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_DATABASE_URL) ||
  "";

// Fallback dummy SQL client if DATABASE_URL is not configured (e.g. isolated build steps)
const createDummySqlClient = () => {
  const dummyFn = (async () => []) as any;
  dummyFn.query = async () => [];
  return dummyFn;
};

/**
 * Neon Serverless SQL Client instance
 */
export const sql = DATABASE_URL ? neon(DATABASE_URL) : createDummySqlClient();

/**
 * Health check helper to test database connectivity
 */
export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  timestamp?: string;
  version?: string;
  error?: string;
}> {
  if (!DATABASE_URL) {
    return { ok: false, error: "DATABASE_URL is not configured in environment variables." };
  }
  try {
    const rows = await sql`SELECT NOW() as now, version() as version;`;
    if (rows && rows.length > 0) {
      return {
        ok: true,
        timestamp: String(rows[0].now),
        version: String(rows[0].version),
      };
    }
    return { ok: false, error: "Empty query response" };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Lightweight keep-alive ping for Neon serverless PostgreSQL.
 * Executes a fast `SELECT 1;` query to keep the compute endpoint warm and active.
 */
export async function pingDatabaseKeepAlive(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  try {
    const res = await sql`SELECT 1 as keepalive;`;
    return Boolean(res && res.length > 0);
  } catch (err) {
    console.warn("[Neon KeepAlive] Heartbeat ping notice:", err);
    return false;
  }
}

/**
 * Persist a new or existing booking into Neon PostgreSQL
 * Also upserts customer profile and records an audit log.
 */
export async function insertBookingToDatabase(booking: Booking): Promise<{
  ok: boolean;
  bookingId: string;
  error?: string;
}> {
  try {
    // 1. Parameterized INSERT or UPDATE into bookings table
    await sql.query(
      `INSERT INTO bookings (
        id, status, service_category, service_name, sub_service, ac_type, ac_brand,
        unit_count, issue_description, preferred_date, preferred_slot, customer_name,
        phone, whatsapp_number, alternate_phone, email, house_building, area,
        address, landmark, city, pincode, latitude, longitude, special_notes,
        estimated_amount, assigned_technician_id, assigned_technician_name,
        attribution, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25,
        $26, $27, $28,
        $29, $30
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        assigned_technician_id = EXCLUDED.assigned_technician_id,
        assigned_technician_name = EXCLUDED.assigned_technician_name,
        estimated_amount = EXCLUDED.estimated_amount,
        updated_at = NOW();`,
      [
        booking.id,
        booking.status || "NEW",
        booking.serviceCategory,
        booking.serviceName,
        booking.subService ?? null,
        booking.acType,
        booking.acBrand ?? null,
        String(booking.unitCount || "1"),
        booking.issueDescription ?? null,
        booking.preferredDate ?? null,
        booking.preferredSlot ?? null,
        booking.customerName,
        booking.phone,
        booking.whatsappNumber ?? null,
        booking.alternatePhone ?? null,
        booking.email ?? null,
        booking.houseBuilding ?? null,
        booking.area ?? null,
        booking.address,
        booking.landmark ?? null,
        booking.city,
        booking.pincode ?? null,
        booking.locationCoordinates?.latitude ?? null,
        booking.locationCoordinates?.longitude ?? null,
        booking.specialNotes ?? null,
        booking.estimatedAmount || 0,
        booking.assignedTechnicianId ?? null,
        booking.assignedTechnicianName ?? null,
        JSON.stringify(booking.attribution || {}),
        booking.createdAt || new Date().toISOString(),
      ]
    );

    // 2. Upsert customer record
    try {
      const cleanPhone = (booking.phone || "").replace(/\D/g, "");
      if (cleanPhone) {
        const existingCust = await sql.query(
          `SELECT id, total_spend FROM customers WHERE mobile = $1 LIMIT 1;`,
          [cleanPhone]
        );

        if (existingCust && existingCust.length > 0) {
          await sql.query(
            `UPDATE customers SET
              name = $2,
              whatsapp = COALESCE($3, whatsapp),
              address = COALESCE($4, address),
              pin = COALESCE($5, pin),
              location = COALESCE($6, location),
              total_spend = total_spend + $7,
              last_booking_date = $8,
              updated_at = NOW()
            WHERE id = $1;`,
            [
              existingCust[0].id,
              booking.customerName,
              booking.whatsappNumber ?? null,
              booking.address,
              booking.pincode ?? null,
              booking.city,
              booking.estimatedAmount || 0,
              booking.preferredDate || new Date().toISOString().split("T")[0],
            ]
          );
        } else {
          const custId = `CUST-2026-${Math.floor(1000 + Math.random() * 9000)}`;
          await sql.query(
            `INSERT INTO customers (
              id, name, mobile, whatsapp, email, address, pin, location,
              latitude, longitude, previous_services, ac_type, number_of_units,
              total_spend, last_booking_date
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8,
              $9, $10, ARRAY[$11], $12, $13,
              $14, $15
            );`,
            [
              custId,
              booking.customerName,
              cleanPhone,
              booking.whatsappNumber ?? null,
              booking.email ?? null,
              booking.address,
              booking.pincode ?? null,
              booking.city,
              booking.locationCoordinates?.latitude ?? null,
              booking.locationCoordinates?.longitude ?? null,
              booking.serviceName,
              booking.acType,
              String(booking.unitCount || "1"),
              booking.estimatedAmount || 0,
              booking.preferredDate || new Date().toISOString().split("T")[0],
            ]
          );
        }
      }
    } catch (custErr) {
      console.warn("Non-fatal: customer upsert skipped:", custErr);
    }

    // 3. Record audit log
    try {
      await sql.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, actor, details)
         VALUES ('BOOKING_CREATED', 'booking', $1, 'Customer Web', $2::jsonb);`,
        [
          booking.id,
          JSON.stringify({
            customerName: booking.customerName,
            serviceName: booking.serviceName,
            amount: booking.estimatedAmount,
            city: booking.city,
          }),
        ]
      );
    } catch (auditErr) {
      console.warn("Non-fatal: audit log write skipped:", auditErr);
    }

    return { ok: true, bookingId: booking.id };
  } catch (err: any) {
    console.error("Failed to insert booking into Neon DB:", err);
    return { ok: false, bookingId: booking.id, error: err?.message || String(err) };
  }
}

/**
 * Update booking status and technician assignment in Neon DB
 */
export async function updateBookingStatusInDatabase(
  bookingId: string,
  status: BookingStatus,
  technicianId?: string,
  technicianName?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await sql.query(
      `UPDATE bookings SET
        status = $2,
        assigned_technician_id = COALESCE($3, assigned_technician_id),
        assigned_technician_name = COALESCE($4, assigned_technician_name),
        updated_at = NOW()
      WHERE id = $1;`,
      [bookingId, status, technicianId ?? null, technicianName ?? null]
    );

    // Audit log
    try {
      await sql.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, actor, details)
         VALUES ('STATUS_UPDATED', 'booking', $1, 'Control Hub', $2::jsonb);`,
        [bookingId, JSON.stringify({ status, technicianId, technicianName })]
      );
    } catch {
      // Non-fatal
    }

    return { ok: true };
  } catch (err: any) {
    console.error(`Failed to update booking ${bookingId} in Neon DB:`, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Fetch all bookings from Neon PostgreSQL ordered by creation time descending
 */
export async function fetchBookingsFromDatabase(limit = 100): Promise<Booking[]> {
  try {
    const rows = await sql.query(
      `SELECT * FROM bookings ORDER BY created_at DESC LIMIT $1;`,
      [limit]
    );

    if (!Array.isArray(rows)) return [];

    return rows.map((r: any) => ({
      id: r.id,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      status: (r.status as BookingStatus) || "NEW",
      serviceCategory: r.service_category || "ac-service",
      serviceName: r.service_name || "AC Service",
      subService: r.sub_service || undefined,
      acType: r.ac_type || "Split AC",
      acBrand: r.ac_brand || undefined,
      unitCount: r.unit_count || "1",
      issueDescription: r.issue_description || undefined,
      preferredDate: r.preferred_date || undefined,
      preferredSlot: r.preferred_slot || undefined,
      customerName: r.customer_name || "",
      phone: r.phone || "",
      whatsappNumber: r.whatsapp_number || undefined,
      alternatePhone: r.alternate_phone || undefined,
      email: r.email || undefined,
      houseBuilding: r.house_building || undefined,
      area: r.area || undefined,
      address: r.address || "",
      landmark: r.landmark || undefined,
      city: r.city || "",
      pincode: r.pincode || "",
      locationCoordinates:
        r.latitude && r.longitude
          ? { latitude: Number(r.latitude), longitude: Number(r.longitude) }
          : undefined,
      specialNotes: r.special_notes || undefined,
      estimatedAmount: Number(r.estimated_amount || 0),
      assignedTechnicianId: r.assigned_technician_id || undefined,
      assignedTechnicianName: r.assigned_technician_name || undefined,
      attribution: typeof r.attribution === "string" ? JSON.parse(r.attribution) : (r.attribution || {}),
    }));
  } catch (err) {
    console.error("Failed to fetch bookings from Neon DB:", err);
    return [];
  }
}

/**
 * Fetch all customers from Neon PostgreSQL
 */
export async function fetchCustomersFromDatabase(limit = 100): Promise<Customer[]> {
  try {
    const rows = await sql.query(
      `SELECT * FROM customers ORDER BY created_at DESC LIMIT $1;`,
      [limit]
    );

    if (!Array.isArray(rows)) return [];

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name || "",
      mobile: r.mobile || "",
      whatsapp: r.whatsapp || r.mobile || "",
      email: r.email || "",
      address: r.address || "",
      pin: r.pin || "",
      location: r.location || "",
      locationCoordinates:
        r.latitude && r.longitude
          ? { latitude: Number(r.latitude), longitude: Number(r.longitude) }
          : undefined,
      previousServices: Array.isArray(r.previous_services) ? r.previous_services : [],
      acType: r.ac_type || "Split AC",
      numberOfUnits: r.number_of_units || "1",
      amcStatus: r.amc_status || "None",
      amcPlan: r.amc_plan || undefined,
      bookingHistory: [],
      totalSpend: Number(r.total_spend || 0),
      lastBookingDate: r.last_booking_date || undefined,
    }));
  } catch (err) {
    console.error("Failed to fetch customers from Neon DB:", err);
    return [];
  }
}

/**
 * Fetch active technicians from Neon PostgreSQL
 */
export async function fetchTechniciansFromDatabase(): Promise<Technician[]> {
  try {
    const rows = await sql.query(
      `SELECT * FROM technicians ORDER BY rating DESC, name ASC;`
    );

    if (!Array.isArray(rows)) return [];

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      city: r.city,
      rating: Number(r.rating || 4.9),
      experienceYears: Number(r.experience_years || 5),
      specialization: Array.isArray(r.specialization) ? r.specialization : [],
      status: r.status || "available",
      activeJobsCount: Number(r.active_jobs_count || 0),
    }));
  } catch (err) {
    console.error("Failed to fetch technicians from Neon DB:", err);
    return [];
  }
}

/**
 * Fetch live dashboard KPIs
 */
export async function fetchDashboardKpisFromDatabase() {
  try {
    const rows = await sql.query(`SELECT * FROM v_dashboard_kpis LIMIT 1;`);
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  } catch (err) {
    console.error("Failed to fetch KPI views from Neon DB:", err);
    return null;
  }
}
