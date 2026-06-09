export type CustomerInfo = {
  id: string;
  display_name: string;
  phone_number: string;
  created_at: string;
};

export type Booking = {
  id: string;
  start_time: string;
  end_time: string;
  menu_note: string;
  status: string;
  customer_id: string;
  customers: { display_name: string } | null;
};

export type RecordPhoto = {
  storage_path: string;
};

export type MedicalRecord = {
  id: string;
  visit_date: string;
  treatment_menu: string;
  chemicals_used: string;
  notes: string;
  record_photos: RecordPhoto[];
};
