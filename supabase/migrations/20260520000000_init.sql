-- 1. stylists (美容師 / 管理者)
CREATE TABLE stylists (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    payment_customer_id VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. customers (顧客)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_user_id VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(50) NOT NULL,
    phone_number VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. bookings (予約トランザクション)
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    stylist_id UUID NOT NULL REFERENCES stylists(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
    menu_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. medical_records (カルテ)
CREATE TABLE medical_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    visit_date DATE NOT NULL,
    treatment_menu VARCHAR(255),
    chemicals_used TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. record_photos (カルテ画像)
CREATE TABLE record_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL REFERENCES medical_records(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. availability_settings (営業時間・休日設定)
CREATE TABLE availability_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stylist_id UUID NOT NULL REFERENCES stylists(id) ON DELETE CASCADE,
    day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
    specific_date DATE,
    start_time TIME,
    end_time TIME,
    is_day_off BOOLEAN NOT NULL DEFAULT false
);

-- 7. subscriptions (サブスクリプション契約)
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stylist_id UUID UNIQUE NOT NULL REFERENCES stylists(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
    plan_id VARCHAR(100) NOT NULL,
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row Level Security (RLS)
ALTER TABLE stylists ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ヘルパー関数: サブスクリプションが有効な美容師かチェック
CREATE OR REPLACE FUNCTION is_active_stylist(stylist_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM subscriptions
    WHERE stylist_id = stylist_uuid
    AND status IN ('active', 'trialing')
    AND current_period_end >= now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ポリシー定義: 美容師向け
-- stylists: 自身のみ閲覧・更新可能
CREATE POLICY "Stylists can view own profile" ON stylists FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Stylists can update own profile" ON stylists FOR UPDATE USING (auth.uid() = id);

-- customers: 自身の予約がある顧客、または自身が作成した顧客を許可する想定（ここでは全顧客へのアクセスを一旦許可しつつアプリ側で制御するか、厳格化する）
-- ※簡易化のため、アクティブな美容師は顧客を閲覧・作成可能とする
CREATE POLICY "Active stylists can manage customers" ON customers
FOR ALL USING (is_active_stylist(auth.uid()));

-- bookings: 自身の予約のみ管理可能
CREATE POLICY "Stylists can manage own bookings" ON bookings
FOR ALL USING (auth.uid() = stylist_id AND is_active_stylist(auth.uid()));

-- medical_records: 自身の担当する顧客のカルテを管理可能 (bookings経由などでチェックするが、簡単のため)
-- 厳密には "WHERE customer_id IN (SELECT customer_id FROM bookings WHERE stylist_id = auth.uid())"
CREATE POLICY "Stylists can manage own medical records" ON medical_records
FOR ALL USING (
  is_active_stylist(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM bookings WHERE bookings.id = booking_id AND bookings.stylist_id = auth.uid()
  )
);

-- record_photos
CREATE POLICY "Stylists can manage record photos" ON record_photos
FOR ALL USING (
  is_active_stylist(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM medical_records
    JOIN bookings ON medical_records.booking_id = bookings.id
    WHERE record_photos.record_id = medical_records.id AND bookings.stylist_id = auth.uid()
  )
);

-- availability_settings
CREATE POLICY "Stylists can manage own availability" ON availability_settings
FOR ALL USING (auth.uid() = stylist_id AND is_active_stylist(auth.uid()));

-- subscriptions: 閲覧のみ
CREATE POLICY "Stylists can view own subscriptions" ON subscriptions
FOR SELECT USING (auth.uid() = stylist_id);

-- ※顧客側（LIFF）からのアクセスについては、Next.jsのAPIルート（Service Role Key使用）経由で
-- line_user_idベースのアクセス制御をアプリケーション層で実装する想定のため、RLSではパブリックアクセスを許可しない。
