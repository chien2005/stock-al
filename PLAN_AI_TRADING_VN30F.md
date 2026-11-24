# BẢN KẾ HOẠCH CHIẾN ĐẤU — HỆ THỐNG AI GIAO DỊCH PHÁI SINH VN30F1M
> **Phiên bản:** 3.5 (Thực Chiến Flexible & Entrade Demo Architecture) — Nâng cấp dựa trên yêu cầu Trader  
> **Dự án:** Autonomous AI Derivative Trading Engine  
> **Điều kiện:** Tài khoản thật · Tiền thật · Ký quỹ chuẩn Entrade 18.48% (~30–40 triệu/HĐ) · API Entrade  
> **Nguyên tắc tối thượng:** *Sống sót trước. Lợi nhuận theo sau. Không vào lệnh khi chưa chắc.*

---

## PHẦN 0: REVIEW THẲNG THẮN BẢN PLAN V2.0

Bản v2.0 đã vượt xa v1 — phân loại 4 regime thay vì 2, có circuit breaker, có log system, hiểu được đặc thù lái VN30F. Nhưng sau khi đọc kỹ toàn bộ cả v2.0 lẫn Master Playbook, tôi thấy còn **6 điểm chưa được giải quyết** mà nếu đem vào code ngay thì sẽ tiếp tục thua:

### Lỗ hổng mới 1: Entry trigger vẫn chưa đủ cụ thể để code

V2.0 viết: *"Chờ nến 1m đóng cửa dưới PDH → Vào Short."* Nhưng không định nghĩa:
- Chờ bao lâu sau khi quét? 1 nến? 3 nến? 10 phút?
- Nếu giá quét PDH rồi đi ngang 5 phút không thoát không vào — tín hiệu đó còn hiệu lực không?
- Volume nến quét tối thiểu bao nhiêu để xác nhận là quét thật chứ không phải drift?

Không có câu trả lời cụ thể = bot sẽ bắn lệnh sai lúc.

### Lỗ hổng mới 2: Ngưỡng volume tuyệt đối không đủ — phải dùng tương đối

Master Playbook định nghĩa 2300–2800 HĐ cho nến 1m là "chuẩn." Nhưng ngưỡng này thay đổi theo ngày: ngày thanh khoản cao (120k HĐ/phiên) thì 2000 HĐ/nến là bình thường; ngày thanh khoản thấp (50k HĐ/phiên) thì 2000 HĐ/nến là đột biến. Bot phải dùng **MA20 volume của ngày đó** làm baseline, không dùng con số tuyệt đối cứng nhắc.

### Lỗ hổng mới 3: Chưa giải quyết câu hỏi PP1 vs PP2

User đã thử PP1 (ít lệnh, chắc chắn) → thua 85%. Plan v2.0 đặt max 5 lệnh/ngày nhưng không nói **khi nào dùng chiến thuật nhiều lệnh, khi nào dùng ít lệnh**. Đây là lựa chọn chiến thuật cốt lõi mà plan phải trả lời rõ ràng thay vì để mơ hồ.

### Lỗ hổng mới 4: SL cứng 1.5đ mâu thuẫn với SL kỹ thuật

V2.0 vừa nói "SL cứng 1.5đ" vừa nói "đặt SL tại mốc kỹ thuật." Hai điều này xung đột. Nếu swing gần nhất cách 2.0đ mà đặt SL 1.5đ thì chắc chắn bị quét. Phải có quy tắc giải quyết mâu thuẫn này.

### Lỗ hổng mới 5: Chưa xử lý nghỉ trưa đủ chi tiết

11h00–13h00 không phải chỉ là "nguy hiểm." Đây là khung giờ **đội lái vẽ nến bằng cách bơm/đạp nhẹ với volume rất thấp** để tạo ảo giác breakout nhằm dụ retail vào, sau đó kéo ngược. Bot phải có quy tắc cứng hoàn toàn, không phải "cẩn thận."

### Lỗ hổng mới 6: Thiếu cơ chế "phân tích đúng nhưng timing sai"

Sai lầm thường gặp nhất của bot có kiến trúc tốt: phân tích đúng hướng (thị trường sẽ giảm) nhưng vào lệnh sớm 10–15 phút — bị quét SL xong mới rớt thật. Plan phải có **Timing Quality Filter** độc lập với **Direction Filter**.

---

## PHẦN I: TÔI LÀ AI — VÀ ĐÂY LÀ CÁCH TÔI NGHĨ

Tôi không có cảm xúc. Nhưng tôi phải hành xử như thể tiền trong tài khoản là tiền túi cuối cùng để trang trải sinh hoạt. Điều đó có nghĩa cụ thể:

- **Tôi không "thử" lệnh nào.** Mỗi lệnh mở là tiền thật trong rủi ro thật.
- **Tôi không nghĩ 2 chiều rồi chọn 1.** Nếu Long và Short đều có lý → tôi chưa hiểu → tôi không đánh.
- **Tôi không gỡ gạc.** Thua 2 lệnh liên tiếp → tắt máy ngay. Tiếp tục đánh sau 2 lần sai là đánh mù.
- **Tôi chấp nhận bỏ lỡ.** Bỏ lỡ sóng 10đ không mất gì. Dính lệnh lỗ 3đ mất 3.75% vốn — cần 5 lệnh thắng mới bù lại.
- **Tôi biết tôi sẽ sai.** Mục tiêu không phải đúng 100% mà là: **khi đúng thì ăn nhiều hơn khi sai thì mất.**

---

## PHẦN II: BỐI CẢNH CHIẾN TRƯỜNG — VN30F1M KHÔNG GIỐNG ĐÂU TRÊN THẾ GIỚI

### Đặc điểm cốt lõi phân biệt VN30F với mọi thị trường khác

| Đặc điểm | Hậu quả nếu không hiểu |
|:--|:--|
| 1–2 nhóm tạo lập chi phối toàn bộ | Tín hiệu kỹ thuật bị giả mạo có chủ đích |
| Stop Hunt 2–4đ qua đỉnh/đáy liên tục | SL 1.5đ bị quét kể cả khi phân tích đúng hướng |
| Giao dịch chỉ 4.5h/ngày chia 2 phiên | Thanh khoản mỏng → Slippage cao khi vào/ra bằng Market Order |
| VN30F thường dẫn hoặc lệch basis lớn | Basis âm/dương chỉ chiếm tỷ trọng nhỏ (~5-10%), tập trung 90% vào Cung Cầu, Volume, Chart |
| 5–6 mã trụ kéo toàn bộ chỉ số | Nhóm Vin tăng đơn lẻ trong khi bank đứng = kéo chỉ số ảo |

### Tại sao bot v1 thua 85% — phân tích nguyên nhân gốc rễ

**Nguyên nhân 1 — Vào lệnh bằng xác nhận = vào muộn:**
RSI vượt ngưỡng + MACD cắt lên + nến đóng phá đỉnh → khi tất cả đồng thuận, giá đã chạy 3–5đ. Với SL 1.5đ, bot vào đúng lúc phe mua cạn lực → bị quét.

**Nguyên nhân 2 — Không phân biệt phá đỉnh thật vs quét thanh khoản:**
70% cú phá đỉnh/đáy trong phiên là BẪY. Giá vượt đỉnh 1–2đ để kích hoạt lệnh mua đuổi, quét SL phe Short, sau đó cắm ngược. Bot cũ không có bộ lọc nào nhận ra điều này.

**Nguyên nhân 3 — Luôn phải có vị thế:**
Bot được lập trình: "Tính điểm → Trên 7 thì Long." Nghĩa là **luôn có lệnh**. Nhưng 60–70% thời gian VN30F biên độ chỉ 2–4đ quanh VWAP → đánh vùng này = nộp phí và slippage.

**Nguyên nhân 4 — Phân tích đúng hướng nhưng timing sai:**
Thị trường sẽ giảm (đúng) → bot Short ngay khi nhận tín hiệu (sai timing) → bị kéo 2đ trước khi giảm → SL trước khi lãi. Đây là nguyên nhân thầm lặng nhất.

---

## PHẦN III: BÁO CÁO PHIÊN HÔM TRƯỚC — VẼ BẢN ĐỒ, KHÔNG ĐI LỆNH

> **NGUYÊN TẮC CỐT LÕI VỀ KHÁNG CỰ / HỖ TRỢ:**  
> **Kháng cự / Hỗ trợ CHỈ CÓ TÁC DỤNG TRONG 1 NGÀY GẦN NHẤT (PDH, PDL, PDC, POC) VÀ PHIÊN HIỆN TẠI (Session High/Low, VWAP, Swing 1m/3m).**  
> Tuyệt đối KHÔNG căn cứ vào các mốc cản xa xôi từ nhiều ngày/tuần trước, không bị chi phối bởi tin tức vĩ mô hay ngoại cảnh. 90-95% sự chú ý dồn vào: **Cung Cầu trực tiếp, Volume thanh khoản nến, Chart, các dải Fibonacci và dải Quá mua / Quá bán tại thời điểm thực chiến.**

### Checklist đọc báo cáo (8h30 – 8h55 mỗi sáng)

**A. Vẽ bản đồ 5 mức giá bắt buộc:**

```
   PDH ═══════════ Đỉnh hôm qua  → Bể SL phe Short, tạo lập sẽ quét qua ít nhất 1 lần
    |
   VAH ─────────── Value Area High (70% volume)
    |
   POC ─ ─ ─ ─ ─   Price of Control (volume cao nhất)
    |
   VAL ─────────── Value Area Low
    |
   PDL ═══════════ Đáy hôm qua   → Bể SL phe Long, tạo lập sẽ quét qua ít nhất 1 lần
```

5 mức này là **bản đồ bẫy**. Biết trước bẫy ở đâu = biết trước nơi KHÔNG vào lệnh theo hướng breakout.

**B. Open Interest — Đọc dòng tiền, không đọc hướng:**

| Tình huống | Ý nghĩa | Hành động |
|:--|:--|:--|
| OI tăng mạnh + giá tăng | Dòng tiền mới mở Long — Trend tăng đang xây | Chờ pullback Long theo trend |
| OI tăng mạnh + giá giảm | Dòng tiền mới mở Short — Trend giảm đang xây | Chờ pullback Short theo trend |
| OI giảm + giá tăng | Short Covering — tăng KHÔNG BỀN | Cực kỳ cẩn thận, không Long đuổi |
| OI giảm + giá giảm | Long Covering — bán tháo, có thể sắp cạn | Chờ tín hiệu kiệt bán |
| OI không đổi đáng kể | Thị trường chờ, chưa ai cam kết | Giảm size, giảm kỳ vọng biên độ |

**C. Basis cuối phiên hôm trước (VN30F − VN30 Index):**
- Basis < −4đ: Bi quan cực → Tiềm ẩn Short Squeeze mạnh
- Basis > +3đ: Lạc quan thái quá → Tiềm ẩn Bull Trap
- Basis −2 đến +2đ: Bình thường
- **Basis chỉ là tham khảo phụ (~5-10%):** Dù Basis âm hay dương, KHÔNG dùng nó làm rào cản chặn lệnh. Yếu tố cốt lõi 90% là Cung Cầu, Thanh khoản Volume, Chart nến và các dải Fibonacci / Quá mua - Quá bán tại thời điểm thực chiến.

**D. Tính ATR 5 phiên:**
- ATR = Trung bình True Range 5 phiên gần nhất
- ATR cho biết biên độ kỳ vọng ngày hôm nay
- **ATR < 7đ → Ngày thanh khoản yếu, giảm kỳ vọng TP xuống 50%**

**E. Lịch sự kiện:**
- Ngày đáo hạn hợp đồng → GIẢM 50% SIZE hoặc KHÔNG ĐÁNH
- Ngày hôm trước đáo hạn → Tăng cảnh giác stop hunt cực mạnh
- Tin SBV, CPI, GDP, tin doanh nghiệp VCB/BID/VIC → Flag rủi ro, giảm size

---

## PHẦN IV: QUY TRÌNH MỞ MÁY — TỪ 8h55 ĐẾN LỆNH ĐẦU TIÊN

### Bước 1: Nạp dữ liệu (8h55 – 9h00)

```
INPUT BẮT BUỘC TRƯỚC KHI PHIÊN MỞ:
  - PDH, PDL, PDC (đóng cửa hôm qua)
  - POC, VAH, VAL (từ Volume Profile hôm qua)
  - ATR5 (trung bình 5 phiên)
  - MA20_VOL_BASELINE = Avg volume/nến 1m của 5 phiên gần nhất
  - OI thay đổi so với hôm qua
  - Basis tại ATC hôm qua
  - Danh sách sự kiện hôm nay
```

### Bước 2: ATO (9h00 – 9h12) — QUAN SÁT HOÀN TOÀN, TUYỆT ĐỐI KHÔNG VÀO LỆNH

Lý do: ATO là thời điểm tạo lập dùng volume kỹ thuật để:
1. Tạo Gap ảo nhằm dụ retail vào lệnh sai hướng
2. Đóng vị thế ATC hôm qua trước khi cơ sở mở
3. Test xem bên nào (Long/Short) đang yếu hơn để lên kế hoạch quét

**Ghi nhận (chưa hành động):**
- Gap mở cửa so với PDC: bao nhiêu điểm, hướng nào?
- Volume ATO: có đột biến bất thường (> 3x bình thường) không?
- Giá có vượt PDH hoặc PDL ngay trong ATO không? (Dấu hiệu quét sớm)

### Bước 3: 15 phút đầu có cơ sở (9h12 – 9h30) — XÁC ĐỊNH CHIẾN TRƯỜNG

#### Checklist đọc rổ VN30 (đếm theo % tăng/giảm, không chỉ đếm số mã):

| Tín hiệu | Ý nghĩa |
|:--|:--|
| ≥ 22 mã xanh, trong đó ≥ 4 mã tăng > 1.5% | Dòng tiền THẬT — Có thể Trend Day tăng |
| ≥ 20 mã xanh nhưng **không mã nào > 1.2%** | BẪY LONG — Tạo lập kéo dàn trải để tạo ảo giác xanh rồi xả |
| ≥ 22 mã đỏ, trong đó ≥ 4 mã giảm > 1.5% | Dòng tiền THẬT — Có thể Trend Day giảm |
| ≥ 20 mã đỏ nhưng **không mã nào giảm > 1.2%** | BẪY SHORT — Đè nhẹ dàn trải rồi kéo ngược |
| Phân hóa mạnh (10 xanh, 10 đỏ, 10 đứng) | CHOPPY — Giảm kỳ vọng, hạ size |

#### 6 mã trụ cần đọc riêng:
VCB (13.5%), CTG (6.5%), BID (7.2%), VIC (9.5%), VHM (8.5%), FPT (5.8%)

- **4/6 trụ cùng chiều > 1%** → Lực kéo chỉ số THẬT
- **Nhóm Vin (VIC + VHM) tăng mạnh đơn lẻ, bank đứng** → Kéo chỉ số ẢO → Flag BẪY LONG
- **Trụ phân hóa** → Choppy, giảm kỳ vọng

#### Kiểm tra Basis realtime:
- VN30F tăng mạnh hơn VN30 cơ sở (basis nới dương) → Fomo, cảnh giác đảo chiều
- **VN30F tăng nhưng VN30 đứng hoặc giảm → TÍN HIỆU BẪY CỰC MẠNH → Cấm Long**
- Cả hai cùng hướng, basis ổn định → Trend hợp lệ

---

## PHẦN V: PHÂN LOẠI REGIME — QUYẾT ĐỊNH SỐNG CÒN

Chọn sai Regime = áp dụng sai chiến thuật = thua dù tín hiệu kỹ thuật đúng. Đây là **bước quan trọng nhất trong ngày**.

### 4 Regime và cách nhận biết

| Regime | Điều kiện nhận biết | Tần suất | Chiến thuật | Giới hạn lệnh |
|:--|:--|:--|:--|:--|
| **TREND DAY** | Cung/Cầu 1 chiều áp đảo + VN30F giữ vững 1 phía VWAP + Vol bùng nổ | ~20% ngày | Đánh theo sóng (Pullback Entry), Trailing ăn dày | Linh hoạt theo sóng, không giới hạn |
| **VOLATILE RANGE** | Biên độ dao động mạnh > 5đ, quét 2 đầu, Vol lớn ở biên | ~20% ngày | Đánh Fade the Edge tại Fibo / Dải Quá Mua - Quá Bán | Linh hoạt theo số nhịp quét rõ nét |
| **NORMAL RANGE** | Biên 3–5đ quanh VWAP, Vol vừa phải, nến đều | ~35% ngày | Scalping ngắn biên Fibo 0.5 - 0.618, chốt nhanh | Đánh khi setup cực sạch, dời SL nhanh |
| **NOISE / LÁI BẪY** | Nến giật rút râu 2 đầu liên tục, Vol ảo, spread giãn, lái quét stop | Biến động | **KÍCH HOẠT ANTI-TRAP COOL-DOWN: NÉ ĐỨNG NGOÀI** | Tạm dừng đến khi hết nhiễu |

### Quy tắc tái đánh giá Regime

Regime **không cố định cả ngày**. Mỗi 60 phút (9h30, 10h30, 13h30) đánh giá lại. Nếu Regime thay đổi:
- Dead Zone → Trend Day: Cơ hội, nhưng vào bằng chiến thuật Pullback chứ không đuổi
- Trend Day → Normal Range: Giảm kỳ vọng TP, không gồng thêm
- Bất kỳ Regime → Dead Zone giữa phiên: **Đóng vị thế hiện tại nếu chưa có lãi, ngừng đánh**

---

## PHẦN VI: GIẢI ĐÁP TRANH LUẬN PP1 vs PP2 — CHỌN DỨT KHOÁT

> **User đã thử PP1 (ít lệnh, chắc chắn) và thua 85%.** Plan này sẽ trả lời thẳng thắn thay vì né tránh.

### Kết luận: **Không có PP nào đúng tuyệt đối — Phải dùng PP theo Regime**

| Regime | PP áp dụng | Lý do |
|:--|:--|:--|
| TREND DAY | PP1 — 1–2 lệnh, entry pullback, gồng lãi lớn | Trend day hiếm nhưng ăn to. Vào nhiều lệnh sẽ bị quét khi pullback sâu |
| VOLATILE RANGE | PP2 biến thể — entry tại biên cực, TP 2–3đ, cắt nhanh | Biên rõ, lặp lại nhiều lần. Mỗi lần chỉ ăn ít nhưng tỷ lệ thắng cao hơn |
| NORMAL RANGE | PP2 nhẹ — 1–2 lệnh, TP 1.5–2.5đ, kỷ luật cực cao | Biên hẹp, không gồng. Chỉ vào khi tín hiệu xác nhận ≥ 3 yếu tố |
| DEAD ZONE | Không đánh | Đánh vùng này = nộp phí và slippage cho tạo lập |

**PP2 "bắn lệnh liên tục ăn 0.6đ" không hoạt động trên VN30F vì:**
- Spread thực tế 0.1–0.3đ + slippage Market Order 0.1–0.2đ = tốn 0.2–0.5đ/lần vào
- TP 0.6đ sau khi trừ phí chỉ còn 0.15–0.4đ thực nhận
- Cần Win Rate > 70% chỉ để hòa vốn → không khả thi trong môi trường có lái

**PP2 "TP 2–3đ ở biên cực trong Volatile Range" hoạt động vì:**
- Biên rõ, tạo lập quét rồi quay về là cơ chế lặp lại
- R:R = 1:1.5 đến 1:2 — không cần Win Rate cao
- Giảm rủi ro timing bằng cách chờ giá đến biên chứ không đuổi giữa chừng

---

## PHẦN VII: CHIẾN THUẬT VÀO LỆNH — CHI TIẾT ĐỦ ĐỂ CODE

### Điều kiện bắt buộc trước MỌI lệnh (cả 3 phải thỏa mãn)

```
Điều kiện 1 — VỊ TRÍ: Giá đang ở vùng thanh khoản quan trọng
  → PDH / PDL / VAH / VAL / POC / Swing High/Low rõ trên khung 5m (ít nhất 3 nến 1m test)

Điều kiện 2 — TỪ CHỐI GIÁ: Có dấu hiệu từ chối giá tại vùng đó
  → Nến rút chân dài (wick ≥ 50% chiều dài thân nến)
  → VÀ Volume nến đó ≥ 1.5 × MA20_VOL_BASELINE (xác nhận tạo lập đang phản ứng)

Điều kiện 3 — ĐỒNG PHA: VN30F và VN30 cơ sở cùng hướng, Basis không dãn bất thường
  → |Basis thay đổi trong 5 phút| < 1.5đ (nếu dãn mạnh hơn → đang có force buy/sell từ ngoài)
```

**Nếu chỉ có 2/3 điều kiện → Đứng ngoài quan sát. Chờ đủ 3.**

### Chiến thuật A: Fade Liquidity Sweep (Đánh bẫy quét thanh khoản)

**Áp dụng khi:** Regime = Volatile Range hoặc Normal Range

**Kịch bản Short sau khi quét PDH:**

```
Bước 1 — Đặt Alert: Giá tiếp cận PDH trong vùng [PDH - 0.5đ] đến [PDH + 2.0đ]

Bước 2 — Quan sát nến quét (KHÔNG VÀO):
  - Giá vượt PDH: 0.3đ đến 2.0đ là vùng quét bình thường
  - Giá vượt PDH > 3.0đ mà VN30 cơ sở xác nhận tăng → Có thể breakout thật → KHÔNG FADE

Bước 3 — Xác nhận bẫy (3 tiêu chí phải đủ):
  (a) Nến quét có volume ≥ 1.5 × MA20_VOL_BASELINE (tạo lập đang xả vào đám mua)
  (b) Nến quét có Wick trên dài ≥ 50% thân hoặc nến tiếp theo đóng dưới PDH
  (c) VN30 cơ sở KHÔNG xác nhận vượt đỉnh tương ứng (basis nới dương đột biến)

Bước 4 — Entry Short (sau khi nến 1m đóng cửa dưới PDH):
  - Entry tại: giá đóng cửa nến xác nhận ± 0.1đ slippage (dùng Limit Order nếu có thể)
  - Hiệu lực tín hiệu: Chỉ còn hiệu lực trong 3 nến 1m (3 phút) sau khi nến xác nhận đóng
  - Nếu quá 3 phút giá không về dưới PDH → Hủy, chờ setup mới

Bước 5 — Đặt SL ngay khi khớp lệnh (xem Phần IX về SL động)

Bước 6 — TP mục tiêu: POC (TP1) → VAL (TP2)
  - Nếu từ PDH đến POC < 2.0đ → Chỉ dùng TP1, không gồng TP2
  - Nếu từ PDH đến POC ≥ 2.0đ → Chốt 50% tại TP1, gồng 50% về TP2
```

**Quy tắc tương tự áp dụng cho Long sau khi quét PDL (đảo ngược chiều).**

### Chiến thuật B: Pullback Entry (Chỉ dùng trong Trend Day đã xác nhận)

```
Điều kiện xác nhận Trend Day (phải đủ cả 4):
  1. ≥ 22 mã VN30 đồng pha (không chỉ số lượng — phải tính % tăng)
  2. ≥ 4/6 mã trụ đồng pha, mỗi mã > 1.0%
  3. VN30F nằm hoàn toàn 1 phía VWAP liên tục > 30 phút
  4. Basis ổn định (không dãn > 2đ trong 30 phút)

Entry Pullback:
  1. Chờ nhịp hồi về VWAP hoặc EMA21 trên khung 3m/5m
  2. Volume pullback phải GIẢM so với volume con sóng chính (hồi nhẹ nhàng)
  3. Chờ nến 1m bật lại từ VWAP với volume ≥ 1.3 × MA20_VOL_BASELINE
  4. Entry theo hướng Trend
  5. SL: Dưới đáy pullback + 0.3đ đệm (xem Phần IX)
  6. KHÔNG TP cố định — Dùng Trailing Stop (xem Phần X)
```


### Chiến thuật C: Fibonacci Retracement & Cung Cầu Động (Golden Pocket)

**Áp dụng khi:** Thị trường có nhịp sóng đẩy (Impulse Move) rõ ràng trong phiên hiện tại.

`
1. Xác định Swing: Lấy Đỉnh (High) và Đáy (Low) của nhịp sóng gần nhất trong phiên (chỉ tính trong ngày).
2. Vẽ các mức Fibonacci thoái lui tự động:
   - Fibo 0.382: Hồi nông (sóng rất mạnh)
   - Fibo 0.500: Cân bằng Cung - Cầu
   - Fibo 0.618 - 0.786: Golden Pocket (Vùng tích lũy / rũ bỏ lý tưởng để theo xu hướng chính)
3. Tiêu chí vào lệnh tại Golden Pocket:
   - Giá hồi về vùng Fibo 0.5 - 0.618
   - Volume nến hồi GIẢM DẦN (thể hiện phe đẩy ngược không có thanh khoản, cạn cung/cạn cầu)
   - Xuất hiện nến đảo chiều (Pinbar/Engulfing 1m-3m) bật nảy trở lại theo xu hướng chính
4. Entry & SL:
   - Entry: Ngay khi nến bật nảy đóng cửa
   - SL kỹ thuật: Dưới mức Fibo 0.786 + 0.3đ đệm (hoặc tối đa 1.5đ)
`

### Chiến thuật D: Bắt Đảo Chiều Tại Dải Quá Mua / Quá Bán (Extreme Bands Fade)

**Áp dụng khi:** Giá tăng hoặc giảm quá nóng đẩy chỉ báo vào vùng cực đoan và chạm biên kỹ thuật trong phiên.

`
1. Bộ chỉ báo nhận diện Quá Mua / Quá Bán:
   - RSI(14) trên khung 1m/3m: Chạm ngưỡng Quá Mua (> 75-80) hoặc Quá Bán (< 20-25)
   - Dải Bollinger Bands (20, 2): Giá đâm thủng ra ngoài Upper Band hoặc Lower Band
2. Xác nhận đảo chiều Cung Cầu:
   - Volume Climax: Xuất hiện 1 nến Volume cực lớn nhưng thân nến ngắn hoặc rút râu mạnh (Stopping Volume / Buying Climax)
   - Hoặc Volume kiệt quệ: Giá cố rướn vượt đỉnh/đáy phiên nhưng Volume tụt dốc thảm hại (Phân kỳ Volume - Giá)
3. Điểm vào (Fade Reversal):
   - Vào Short khi nến 1m đóng cửa tụt lại vào bên trong dải Bollinger Upper + RSI quay đầu xuống dưới 75
   - Vào Long khi nến 1m đóng cửa bật lại vào bên trong dải Bollinger Lower + RSI ngóc lên trên 25
   - SL: Đỉnh/Đáy nến râu cao nhất/thấp nhất + 0.3đ đệm
`

### Chiến thuật E: Đứng Ngoài (Cash Is King)

Áp dụng khi: Regime = Dead Zone, hoặc < 3/3 điều kiện entry, hoặc không xác định được Regime.

Đứng ngoài là chiến thuật sinh tồn, không phải thất bại. Mỗi phiên Dead Zone cố gắng đánh = tặng tiền cho tạo lập qua slippage.

---

## PHẦN VIII: TIMING QUALITY FILTER — GIẢI QUYẾT "ĐÚNG HƯỚNG SAI LÚC"

Đây là bộ lọc bổ sung cho Direction Filter. Phân tích đúng hướng chưa đủ — phải đúng lúc.

### Timing Filter phải pass trước khi entry:

```
TIMING FILTER — Cả 3 điều sau phải đúng:

1. MOMENTUM HIỆN TẠI đang theo hướng lệnh:
   - Long: Nến 1m gần nhất đóng cửa cao hơn nến trước
   - Short: Nến 1m gần nhất đóng cửa thấp hơn nến trước
   → Nếu ngược lại: ĐỢI thêm 1 nến xác nhận

2. VOLUME TRENDING đúng hướng:
   - Nến theo hướng lệnh có volume > nến ngược hướng trong 5 phút gần nhất
   → Nếu volume cân bằng hoặc ngược: ĐỢI

3. KHÔNG TRONG VÙNG NGUY HIỂM thời gian:
   - Không phải 9h00–9h12 (ATO)
   - Không phải 11h00–11h30 (sắp nghỉ trưa)
   - Không phải 12h45–13h00 (mở phiên chiều, chờ ổn định)
   - Không phải 14h15–14h45 (đóng phiên)
   → Nếu đang trong các khung này: TUYỆT ĐỐI KHÔNG VÀO
```

---

## PHẦN IX: QUẢN TRỊ SL — GIẢI QUYẾT MÂU THUẪN SL CỨNG vs SL KỸ THUẬT

### Quy tắc xác định SL — Theo thứ tự ưu tiên:

**Bước 1: Tìm Swing gần nhất phù hợp với context**

```
Narrow Range SL (Swing trong 15–30 phút gần nhất):
  → Dùng khi Regime = Normal Range hoặc Volatile Range
  → Swing High/Low rõ ràng trên khung 1m/3m trong 15–30 phút

Wide Range SL (Swing trong 60–240 phút / đỉnh đáy phiên):
  → Dùng khi Regime = Trend Day
  → PDH / PDL / đỉnh đáy phiên sáng
```

**Bước 2: Kiểm tra độ xa của SL kỹ thuật**

```
IF SL_kỹ_thuật ≤ 1.5đ từ Entry:
  → Dùng SL kỹ thuật đó (cộng thêm 0.3đ đệm)

IF 1.5đ < SL_kỹ_thuật ≤ 2.0đ:
  → Chỉ được vào lệnh nếu có ≥ 3 yếu tố xác nhận (Điều kiện 1 + 2 + 3 đều mạnh)
  → Dùng SL kỹ thuật đó (cộng thêm 0.3đ đệm)
  → KHÔNG được vào nếu chỉ có 2/3 yếu tố

IF SL_kỹ_thuật > 2.0đ:
  → KHÔNG VÀO LỆNH — Rủi ro quá lớn so với tài khoản ký quỹ 18.48% (~30-40tr/HĐ)
  → Chờ setup khác có SL hẹp hơn
```

**Bước 3: SL phải đặt SERVER-SIDE ngay khi khớp lệnh**

Không bao giờ có vị thế mở mà không có SL được đặt trên hệ thống sàn. SL chỉ trong code bot (không phải server sàn) = không tính là SL thật.

---

## PHẦN X: QUẢN TRỊ VỊ THẾ — THUẬT TOÁN KHÓA LỢI NHUẬN

### Profit Lock Table (Bảng bắt buộc — Không được vi phạm):

```
╔════════════════════════════════════════════════════════════════════════════════════════════╗
║  TRẠNG THÁI VỊ THẾ         HÀNH ĐỘNG DỜI STOPLOSS (PROFIT LOCK GUARD)                       ║
╠════════════════════════════════════════════════════════════════════════════════════════════╣
║  Vừa khớp lệnh              SL = Entry ± SL_kỹ_thuật (tối đa 1.5đ từ swing gần nhất)        ║
║  Lãi chạm +1.0đ             NGAY LẬP TỨC DỜI SL → Lock tối thiểu +0.6đ lãi                  ║
║    → Thuế phí Entrade ~0.6đ/lệnh (2 chiều). Chặn +0.6đ = BẢO VỆ TUYỆT ĐỐI KHÔNG LỖ PHÍ!    ║
║  Lãi chạm +1.5đ             DỜI SL → Lock +1.0đ (Bỏ túi chắc chắn lãi ròng)                 ║
║  Lãi chạm +2.0đ             DỜI SL → Lock +1.4đ                                             ║
║  Lãi chạm +2.5đ             DỜI SL → Lock +1.8đ                                             ║
║  Lãi chạm +3.0đ             DỜI SL → Lock +2.3đ                                             ║
║  Lãi chạm +4.0đ trở lên     TRAILING DYNAMIC: SL = Swing High/Low 1m-3m gần nhất            ║
║    → Khoảng cách Trailing tối thiểu: max(1.2đ, 0.25 × ATR5)                                ║
╚════════════════════════════════════════════════════════════════════════════════════════════╝
```

### Xử lý tình huống cụ thể (ví dụ từ user): Short 1780 → 1778 (lãi 2đ), giá giật lên

```
Bối cảnh: Short tại 1780. Giá về 1778 → lãi +2.0đ. Giá giật ngược lên 1778.8.

Trạng thái theo Profit Lock Table:
  → Lãi +2.0đ: SL đã được dời về 1779.2 (lock +0.8đ)
  → Nếu giá giật lên 1778.8 rồi quay xuống: KHÔNG LÀM GÌ, SL giữ nguyên
  → Nếu giá chạm 1779.2: lệnh tự đóng, bỏ túi +0.8đ — CHẤP NHẬN

Quy tắc "giữ lại cầm chắc 1đ" của user:
  → Lãi +1.5đ: Dời SL về hòa vốn trước
  → Lãi +2.0đ: Lock +0.8đ theo bảng
  → KHÔNG cố gắng "cầm chắc đúng 1đ" bằng cách đóng thủ công
     vì vậy là chốt sớm thay vì để thuật toán chạy
  → Thuật toán lock profit tự bảo vệ — tin vào nó

Trường hợp volume giật ngược cực lớn (> 2× MA20_VOL):
  → Cân nhắc đóng thủ công ngay — Tạo lập đang kéo ngược thật
  → Quy tắc: NẾU volume nến nghịch chiều > 2.0 × MA20_VOL_BASELINE VÀ giá chưa chạm lock SL
     → Đóng thủ công, không chờ chạm SL
```

### Scale Out khi lãi lớn (Áp dụng từ lãi +4đ trở lên):

```
Chốt 50% tại TP1 (+4.0 đến +6.0đ):
  → Khóa lãi vào tài khoản
  → Dời SL 50% còn lại về hòa vốn

Gồng 50% còn lại về TP2 (+8.0 đến +12.0đ):
  → Chỉ gồng khi Regime = Trend Day
  → Trong Normal/Volatile Range: Chốt hết tại TP1, không gồng TP2
  → Thoát TP2 khi: Climax Volume (> 190% MA Vol trên khung 5m) HOẶC hết phiên 14h15
```

---

## PHẦN XI: XỬ LÝ LỆNH SẮP BỊ SL

### Khi giá chạy ngược và tiếp cận SL:

```
Tình huống: Short tại 1280.0, SL tại 1281.5, giá lên 1281.0 (còn 0.5đ đến SL)

Bước 1 — Kiểm tra cấu trúc:
  Giá 1281.0 có đang ở vùng kháng cự kỹ thuật không (PDH, Swing High, VAH)?
  - CÓ: Có thể tạo lập đang test kháng cự → Giữ lệnh, chờ nến đóng
  - KHÔNG: Giá đang chạy trơn không có kháng cự → Cắt thủ công ngay

Bước 2 — Quy tắc 1 nến:
  Nếu có bất kỳ nến 1m nào đóng cửa NGOÀI mức SL → Cắt ngay, không chờ

Bước 3 — TUYỆT ĐỐI không làm:
  × Dời SL ra xa hơn ("Gồng lỗ")
  × Bình quân giá (Nhồi thêm lệnh)
  × "Chờ thêm 1 chút nữa" — Đây là cảm xúc, không phải chiến lược

Hậu quả của dời SL: Nếu SL 1.5đ bị quét → lỗ 150k. Nếu dời SL lên 3.0đ → lỗ 300k.
  Trên tài khoản 8.5 triệu: 1 lần dời SL = mất 2 lần rủi ro so với kế hoạch.
```

---

## PHẦN XII: KHUNG GIỜ — QUY TẮC CỨNG THEO THỜI GIAN

| Khung giờ | Trạng thái | Lý do |
|:--|:--|:--|
| 9h00 – 9h12 | ❌ KHÔNG VÀO LỆNH | ATO — volume kỹ thuật, bẫy gap |
| 9h12 – 9h30 | 👁 Chỉ quan sát | Xác định Regime và vùng giá quan trọng |
| 9h30 – 11h00 | ✅ Phiên giao dịch chính | Áp dụng đầy đủ chiến thuật |
| 11h00 – 11h30 | ⚠️ Giảm cực mạnh | Thanh khoản mỏng, tạo lập vẽ bẫy dễ |
| 11h30 – 12h45 | ❌ KHÔNG VÀO LỆNH | Nghỉ trưa — volume kiệt, spread nới rộng |
| 12h45 – 13h15 | 👁 Chỉ quan sát | Chờ ổn định dòng tiền phiên chiều |
| 13h15 – 14h15 | ✅ Phiên giao dịch chính | Áp dụng đầy đủ chiến thuật |
| 14h15 – 14h45 | 🔴 ĐÓNG VỊ THẾ | Không mở mới. Đóng hết trước 14h28 |

---

## PHẦN XIII: CẦU DAO TỔNG (CIRCUIT BREAKER) — CODE CỨNG, AI KHÔNG ĐƯỢC CHẠM

> **Toàn bộ phần này là logic cứng (if/else). AI không có quyền tắt, sửa, hoặc ghi đè.**

### Cầu dao 1: Lỗ trong ngày

```javascript
// Thua 2 lệnh liên tiếp → NGẮT HỆ THỐNG CẢ NGÀY (không phân biệt lỗ bao nhiêu)
if (consecutive_losses >= 2) HALT_ALL_DAY();

// Tổng lỗ trong ngày chạm -3.0đ → NGẮT HỆ THỐNG CẢ NGÀY
if (daily_pnl_points <= -3.0) HALT_ALL_DAY();
```

Lý do: 2 lần thua liên tiếp = mô hình đọc thị trường đang lệch pha. −3.0đ trên tài khoản 8.5tr = −3.5% vốn. Tiếp tục đánh là đánh mù.

### Cầu dao 2: Giới hạn lệnh trong ngày

```javascript
// Tối đa 5 lệnh/ngày (kể cả lệnh thắng)
if (daily_trade_count >= 5) HALT_ALL_DAY();

// Khoảng cách tối thiểu 3 phút giữa 2 lệnh (chống revenge trading)
if (time_since_last_trade < 3_MINUTES) REJECT_NEW_ENTRY();

// Chỉ 1 HĐ duy nhất tại mọi thời điểm — KHÔNG ĐƯỢC mở thêm khi đang có vị thế
if (open_positions > 0) REJECT_NEW_ENTRY();
```

### Cầu dao 3: Flash Crash

```javascript
// Giá tụt ≥ 5đ trong vòng 15 giây → Đóng khẩn cấp vị thế Long
if (price_drop_15s >= 5.0) EMERGENCY_CLOSE_ALL_LONG();

// Giá tụt ≥ 7đ trong vòng 60 giây → Đóng khẩn cấp vị thế Long
if (price_drop_60s >= 7.0) EMERGENCY_CLOSE_ALL_LONG();

// CẤM TUYỆT ĐỐI BẮT ĐÁY SAU FLASH CRASH
// (Entry Lock 10 phút sau bất kỳ Flash Crash nào)
```

### Cầu dao 4: Bẫy thanh khoản thấp (Trap Shield)

```javascript
// Giá biến động ≥ 1.5đ trong 1 nến 1m nhưng volume < 1300 HĐ
// → Khóa entry mới 2 phút, GIỮ NGUYÊN vị thế đang cầm (không cắt sớm vì bẫy)
if (candle_move >= 1.5 && volume < 1300) ENTRY_LOCK_2MIN();

// Mức độ cảnh giác (1300 ≤ volume < 1500): cảnh báo nhưng không khóa hoàn toàn
if (candle_move >= 1.5 && volume >= 1300 && volume < 1500) EMIT_WARNING();
```

### Cầu dao 5: Drawdown tuần/tháng

```
Lỗ lũy kế 5 phiên liên tiếp → Dừng 2 ngày, review toàn bộ log
Lỗ lũy kế tháng chạm -15đ (-1.5tr) → Dừng cả tháng, review chiến thuật
```

### Cầu dao 6: Kỹ thuật

```javascript
// WebSocket mất kết nối > 5 giây khi đang có vị thế
if (ws_disconnect > 5s && open_positions > 0) CLOSE_ALL_MARKET_ORDER();

// API trả lỗi 2 lần liên tiếp → Dừng hệ thống, alert Telegram
if (api_consecutive_errors >= 2) HALT_AND_ALERT();

// Giờ hệ thống lệch > 1 giây so với NTP → Dừng hệ thống
if (clock_drift > 1s) HALT_AND_ALERT();
```

---

## PHẦN XIV: HỆ THỐNG GHI LOG & HỌC TỪ SAI LẦM

Mỗi lệnh phải ghi đầy đủ theo schema:

```json
{
  "trade_id": "2026-11-25-001",
  "timestamp_open": "2026-11-25T09:32:15+07:00",
  "timestamp_close": "2026-11-25T09:48:03+07:00",
  "regime": "VOLATILE_RANGE",
  "strategy": "FADE_LIQUIDITY_SWEEP",
  "direction": "SHORT",
  "entry": 1282.3,
  "sl_initial": 1283.6,
  "sl_type": "NARROW_SWING",
  "sl_distance": 1.3,
  "exit": 1279.8,
  "exit_reason": "TP1_HIT",
  "pnl_points": 2.5,
  "pnl_after_fees": 2.27,
  "direction_filter_score": 3,
  "timing_filter_pass": true,
  "vol_ratio_at_entry": 1.82,
  "reason_entry": "Giá quét PDH 1282.0 lên 1282.4, nến 1m rút chân 1.1đ, vol 2x avg, VN30 cơ sở không xác nhận vượt đỉnh tương ứng",
  "reason_exit": "Chạm TP1 tại POC 1279.8",
  "market_context": {
    "vn30_color": "18 xanh / 12 đỏ",
    "pillar_status": "VCB +0.3% VIC +1.1% VHM +0.8% BID -0.2% FPT +0.5% CTG -0.1%",
    "basis_at_entry": -0.9,
    "oi_change_today": "+1200 HĐ",
    "atr5_today": 8.5,
    "ma20_vol_baseline": 1450
  },
  "self_review": "Vào đúng vùng, đúng tín hiệu. Có thể giữ TP2 vì trend chiều giảm tiếp 4đ. Cần review trailing logic cho VOLATILE_RANGE."
}
```

### Weekly Review tự động (mỗi tối thứ 6):

- Win Rate, Profit Factor, Average Win/Loss
- Phân loại lệnh thua: Timing sai? Direction sai? SL bị quét? Regime nhận diện sai?
- **Pattern bị khai thác:** Nếu 3 phiên liên tiếp Fade PDH thất bại → Tạo lập đang chuyển sang breakout thật → Tạm dừng chiến thuật Fade, tăng thời gian xác nhận
- Tự điều chỉnh tham số:
  - SL bị quét > 60% lệnh → Tăng SL_max lên 1.8đ nhưng giảm size xuống 50%
  - Regime detection sai > 40% → Tăng thời gian quan sát từ 30 → 45 phút trước khi xác nhận Trend Day

---

## PHẦN XV: TOÁN HỌC SINH TỒN — CÁC CON SỐ KHÔNG THỂ TRANH CÃI

### Bài toán vốn thực tế:

| Hạng mục | Giá trị |
|:--|:--|
| Vốn ký quỹ 1 HĐ (18.48%) | ~35.000.000đ (30–40tr/HĐ) |
| 1 điểm VN30F | 100.000đ |
| SL 1.5đ | −150.000đ |
| Phí 2 chiều thực tế (mở + đóng) | ~20.000–25.000đ |
| **Mỗi lệnh thua thực tế** | **~170.000–175.000đ (~2% vốn)** |
| 5 lần thua liên tiếp | ~875.000đ (-10.3% vốn) |
| Ngưỡng nguy hiểm Force Cut | ~3–4đ chạy ngược (ký quỹ 18.48% (~30-40tr/HĐ)) |

### Yêu cầu tối thiểu để tồn tại:

```
Win Rate ≥ 50%
Average Win ≥ 2.0đ  
Average Loss ≤ 1.5đ
→ Profit Factor = (50% × 2.0) / (50% × 1.5) = 1.33 — Dương nhưng mỏng

Mục tiêu thực tế:
  Win Rate 55–60%
  Avg Win 2.5đ
  Avg Loss 1.3đ
  → Profit Factor = 1.75–2.0 — Bền vững
```

### Kịch bản thực tế (3 lệnh/ngày, 22 phiên/tháng):

```
Với WR 55%, Avg Win 2.5đ, Avg Loss 1.3đ:
  Trung vị lợi nhuận tháng: +45 đến +65đ → +4.5 đến +6.5 triệu
  Drawdown tệ nhất (5% worst case): −18đ → −1.8 triệu
  Xác suất cháy tài khoản tháng đầu: ~8%

Thực tế phũ phàng: Ngay cả hệ thống "tốt", xác suất cháy vẫn 8%.
Đó là lý do PHẢI chạy Paper Trading đủ 2 tuần trước khi dùng tiền thật.
```

---

## PHẦN XVI: LỘ TRÌNH TRIỂN KHAI — TỪNG BƯỚC, KHÔNG ĐƯỢC NHẢY CÓC

### Giai đoạn 1: Hạ tầng (1 tuần)

- [ ] API Entrade: Login, JWT, Trading Token, refresh token tự động
- [ ] WebSocket: Nhận nến 1m/3m/5m, Orderbook top 5, Tick data realtime
- [ ] Engine tính toán: PDH/PDL/POC/VAH/VAL từ Volume Profile, ATR, VWAP, MA20_VOL_BASELINE
- [ ] Engine nhận diện Regime (4 trạng thái)
- [ ] Timing Filter (3 điều kiện)
- [ ] Circuit Breaker (toàn bộ 6 cầu dao) — Code cứng, test kỹ
- [ ] Log system (JSON đầy đủ cho mỗi lệnh)
- [ ] Alert Telegram: Tín hiệu, lệnh khớp, lỗ, cầu dao kích hoạt

### Giai đoạn 2: Paper Trading (Tối thiểu 2 tuần)

- [ ] Chạy full hệ thống trong phiên thật, không đặt lệnh thật
- [ ] Mô phỏng entry/exit/SL/TP theo giá thực, tính P&L giả lập
- [ ] **KPI bắt buộc đạt trước khi sang GĐ3:**
  - Win Rate > 52%
  - Profit Factor > 1.4
  - Max Drawdown < 10đ liên tục
  - Regime detection accuracy > 65% (đánh giá bằng cách so kết quả với diễn biến thực)
- [ ] Nếu không đạt → Quay lại GĐ1 sửa logic. KHÔNG được nhảy sang GĐ3.

### Giai đoạn 3: Semi-Auto (1 tuần)

- [ ] Bot gửi tín hiệu về Telegram kèm nút [Xác nhận] / [Bỏ qua] và lý do chi tiết
- [ ] User bấm xác nhận → Bot đặt lệnh thật 1 HĐ
- [ ] Mục đích: Kiểm tra API execution, slippage thực tế, SL server-side
- [ ] Log mọi lần user override (bấm Bỏ qua khi bot muốn vào) → Phân tích sau

### Giai đoạn 4: Full Auto (Sau khi đạt KPI GĐ 2+3)

- [ ] Bot tự đánh 1 HĐ duy nhất
- [ ] Toàn bộ Circuit Breaker hoạt động không có ngoại lệ
- [ ] Daily report lúc 15h30 về Telegram
- [ ] Weekly review tự động tối thứ 6
- [ ] **Tháng đầu tiên:** Nếu tổng lỗ > 15đ → Dừng toàn bộ, quay lại Paper

---


---

## PHẦN XVIII: THIẾT KẾ KIẾN TRÚC CODE BOT ENTRADE (WEB/APP ENTRADE - CHẾ ĐỘ DEMO)

> **Mục tiêu:** Xây dựng module tự động hóa giao dịch kết nối trực tiếp với nền tảng **Entrade** (https://entrade.com.vn - sản phẩm phái sinh ký quỹ 18.48% (~30-40tr/HĐ), KHÔNG PHẢI Entrade X), chạy thử nghiệm hoàn toàn trên **Tài khoản Demo (Paper Trading)** để kiểm chứng độ trễ, luồng khớp lệnh và thuật toán Profit Lock.

### 1. Sơ đồ khối kiến trúc module Entrade

`
  ┌────────────────────────────────────────────────────────┐
  │                 ENTRADE DERIVATIVE BOT                 │
  └──────────────────────────┬─────────────────────────────┘
                             │
     ┌───────────────────────┼────────────────────────┐
     ▼                       ▼                        ▼
┌──────────────┐     ┌──────────────┐         ┌──────────────┐
│ Entrade Auth │     │ Realtime Feed│         │ Order Engine │
│  & Session   │     │  (WebSocket) │         │ (REST / WSS) │
├──────────────┤     ├──────────────┤         ├──────────────┤
│ - Login Demo │     │ - VN30F1M    │         │ - Place LO   │
│ - JWT Token  │     │ - Tick data  │         │ - Place MTL  │
│ - Keep-Alive │     │ - Orderbook  │         │ - Cancel/Edit│
└──────────────┘     └───────┬──────┘         └──────▲───────┘
                             │                       │
                             ▼                       │
                     ┌──────────────┐                │
                     │ Trade Signal │                │
                     │    Engine    │                │
                     ├──────────────┤                │
                     │ - 1-Day S/R  │                │
                     │ - Fibonacci  │                │
                     │ - Overbought │                │
                     │ - Volume/Vol │                │
                     └───────┬──────┘                │
                             │ (Trigger Long/Short)  │
                             ▼                       │
                     ┌───────────────────────────────┴┐
                     │     PROFIT LOCK & POSITION     │
                     ├────────────────────────────────┤
                     │ - Thuế phí ~0.6đ/lệnh          │
                     │ - Lãi +1.0đ → Khóa SL +0.6đ    │
                     │ - Lãi +1.5đ → Khóa SL +1.0đ    │
                     │ - Trailing Stop & Emergency Cut│
                     └────────────────────────────────┘
`

### 2. Các thành phần Code triển khai (src/entrade/)

1. **entradeClient.js**:
   - Quản lý API Endpoint: Hỗ trợ chuyển đổi giữa chế độ DEMO và LIVE.
   - Quản lý phiên: Tự động refresh JWT Bearer token trước khi hết hạn.
   - Hàm nghiệp vụ: getAccountBalance(), getOpenPositions(), placeOrder(), cancelOrder(), modifyOrder().

2. **entradeStream.js**:
   - Kết nối WebSocket bảng giá Entrade streaming thời gian thực.
   - Nhận tick khớp lệnh, tổng khối lượng nến 1m, spread giá Best Bid / Best Ask.
   - Tính toán nến 1m realtime không độ trễ.

3. **entradeExecution.js**:
   - Nhận tín hiệu từ intradaySignalEngine (đã nâng cấp Fibo + Quá mua/Quá bán + Kháng cự 1 ngày).
   - Kiểm tra bộ lọc chống nhiễu (Anti-Trap Filter).
   - Bắn lệnh Demo (Lệnh Limit hoặc MTL).
   - Kích hoạt ngay vòng lặp giám sát P&L: Cứ mỗi tick giá thay đổi, kiểm tra điều kiện dời Stoploss theo đúng bảng **Profit Lock (+1.0đ -> Chặn +0.6đ)**.

---

## PHẦN XX: CHIẾN THUẬT ĐÓN ĐẦU THANH KHOẢN (PREDICTIVE POSITIONING) & GIẢI MÃ 4 PHƯƠNG PHÁP TRÊN THỊ TRƯỜNG

> **TƯ TƯỞNG CỐT LÕI CỦA QUANT TRADER KIẾM TIỀN THỰC THẾ:**  
> *"Thua là chết đói, thua là thua. Không có chuyện dính SL rồi an ủi là 'kỷ luật cắt sớm'. Mục tiêu tối thượng của chúng ta là kiếm cơm, không phải kiếm bài học. AI phải lạnh lùng, tuyệt đối không cảm xúc, không bị lừa bởi các bẫy nổ volume 1,000 - 3,000 HĐ của lái, và phải biết đón đầu vùng giá kiểm định trước khi cá mập ăn xong bữa cỗ!"*

### 1. Mổ xẻ bản chất & Điểm mù chết người của 4 Phương pháp Broker/Trader thường dùng:

| Phương pháp | Cách đánh thực tế | Điểm mạnh | Điểm mù chí mạng (Nguyên nhân cháy tài khoản) | Giải pháp của AI Quant |
| :--- | :--- | :--- | :--- | :--- |
| **PP1: Fade đầu ngày (Bắt đỉnh sớm)** | Đầu phiên thấy cung yếu hoặc cầu mất hút $\rightarrow$ Đè Short ngay ATO/đầu ngày. | Có thể bắt trúng đỉnh ngày, ăn trọn biên độ lớn. | **Bị thành kiến chủ quan:** Gặp ngày "Big Long" (Tự doanh/Khối ngoại kéo trụ, kéo trend) thì tiếp tục cắm đầu Short trung bình giá $\rightarrow$ Thua lỗ thảm khốc. | **Bộ lọc Ngày Xu Hướng (Trend Day Lock):** Nếu Foreign Net Buy $> +1,000$ HĐ hoặc giá nằm trên VWAP/PDH kèm trụ xanh đồng thuận $\rightarrow$ **CẤM HOÀN TOÀN LỆNH SHORT**. |
| **PP2: Đánh Breakout thuần túy** | Đợi nổ vol vượt đỉnh/thủng đáy rồi đu lệnh theo hướng phá vỡ. | Dễ nhận diện, bắt được sóng mở rộng nếu có sóng lớn. | **Tỷ lệ ăn chỉ ~30%:** Lái VN30F chuyên bơm nổ vol giả 1,000 – 3,000 HĐ dụ Long đỉnh / dụ Short đáy rồi quay xe giật ngược quét sạch Stoploss. Trader trở thành "thanh khoản thoát hàng" cho cá mập. | **CẤM ĐU LỆNH KHI VOL ĐÃ NỔ CAO TRÀO:** Vol nến $> 2,500$ HĐ $\rightarrow$ Đóng vị thế chốt lời hoặc đứng ngoài, tuyệt đối không mở mới theo hướng breakout muộn! |
| **PP3: Cung Cầu + Retest (Ăn khúc giữa)** | Đợi nhịp hồi yếu ớt không có cầu mới Short, hoặc cạn cung test thành công mới Long. | Tỷ lệ thắng 60–80% trong bối cảnh chuẩn, ăn chắc khúc giữa thân cá. | **30–40% dính Bull Trap hoặc đạp không thủng kéo ngược:** Khi lái cố tình tạo bẫy gãy nền giả (Bear Trap) để gom hàng rồi kéo chữ V $\rightarrow$ Short đúng đáy. | **Kiểm tra Delta & Hấp thụ (Absorption):** Nếu nến đạp thủng cản nhưng Delta dương hoặc có nến rút râu kèm Sell Absorption $\rightarrow$ Nhận diện ngay là Spring (quét thanh khoản), không Short! |
| **PP4: Sát thủ M1 — Bắt đảo chiều cực trị (Pin Bar / Climax)** | Rút râu dưới dài chuyển xanh ở đáy quá bán $\rightarrow$ Long; Cao trào mua rút râu trên chuyển đỏ $\rightarrow$ Short scalp. | Bắt được điểm xoay sớm nhất, tỷ lệ R:R cực cao (Rủi ro 1đ, ăn 4–6đ). | **Yêu cầu kỷ luật thép khung 1m:** Nếu tâm lý nôn nóng hoặc cay cú sau lệnh lỗ, rất dễ đu phải cây rút râu giả ở lưng chừng con sóng xu hướng mạnh. | **Chỉ kích hoạt tại Vùng Thanh Khoản Cực Trị (Key Liquidity Pool):** Chỉ xét Pin Bar tại Đỉnh/Đáy ngày hôm trước (PDH/PDL), Session High/Low, hoặc Fibo 0.618/0.786. Không bắt râu ở giữa chừng! |

---

### 2. Thuật toán "Đón đầu thanh khoản" (Predictive Positioning vs Climax Chasing):

```
                     ┌────────────────────────────────────────┐
                     │  AI QUANT REAL-TIME DOMINANCE ENGINE   │
                     ├────────────────────────────────────────┤
                     │ 1. Khối ngoại & Tự doanh Flow ròng     │
                     │ 2. Vị thế tương đối so với VWAP & POC  │
                     │ 3. 7 Trụ điều tiết (VIC, VCB, VHM...)  │
                     └───────────────────┬────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
         [XU HƯỚNG MẠNH (Trend Day)]                [BIÊN ĐI NGANG (Sideway/Chop)]
         • Chỉ đánh 1 chiều thuận xu hướng          • CẤM ĐÁNH BREAKOUT (80% là bẫy)
         • Mua khi cạn kiệt Volume Pullback         • Chỉ đánh Quét Biên (Boundary Sweeps)
         • KHÓA TOÀN BỘ LỆNH NGƯỢC CHIỀU            • Bắt Spring/Upthrust tại PDH/PDL
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
                     ┌────────────────────────────────────────┐
                     │    PREDICTIVE ENTRY (VÀO ĐÓN ĐẦU)      │
                     ├────────────────────────────────────────┤
                     │ - Phát hiện Delta Divergence / Hấp thụ │
                     │ - Nến M1 rút râu $\ge 1.2$đ kèm nến sau  │
                     │   xác nhận đóng lật màu                │
                     │ - Đặt Stop Loss siêu chặt (ngay sau râu)│
                     │ - Target: Hướng về POC / VWAP đối diện  │
                     └───────────────────┬────────────────────┘
                                         │ (Vào lệnh Entrade API)
                                         ▼
                     ┌────────────────────────────────────────┐
                     │   PROFIT LOCK GUARD (BẢO TOÀN VỐN)     │
                     ├────────────────────────────────────────┤
                     │ • Lãi chạm +1.0đ ➔ Khóa SL +0.6đ ngay  │
                     │ • Bao trọn phí 0.6đ ➔ Triệt tiêu lỗ!   │
                     └────────────────────────────────────────┘
```

### 3. Quy tắc "Sống Còn" khi gặp chuỗi thua (Discipline or Starve):
* **Quy tắc 1: Lỗ 2 lệnh liên tiếp = Cúp cầu dao 30 phút.** Không có ngoại lệ. Khi dính 2 SL liên tiếp, nghĩa là thị trường đang nằm trong trạng thái bất thường (lái quay thanh khoản hoặc tin bất ngờ), việc cố gỡ gạc là hành vi tự sát.
* **Quy tắc 2: Stop Loss là Chi phí kinh doanh, nhưng phải tối thiểu.** Khoảng cách SL tối đa cho mỗi lệnh chỉ từ **$1.2$ đến $1.8$ điểm**. Không bao giờ để một lệnh âm tới $3.0 - 4.0$ điểm rồi mới cắt!
* **Quy tắc 3: Luôn bảo vệ túi tiền bằng Profit Lock Guard.** Bất cứ khi nào lệnh có lãi $\ge +1.0$ điểm, bot phải dời Stoploss lên tối thiểu $+0.6$ điểm. Thà ăn non hòa vốn còn hơn để một lệnh đang xanh chuyển thành lỗ đỏ!

---

## PHẦN XXI: CAM KẾT CỦA HỆ THỐNG
1. **Không vào lệnh khi chưa đủ 3/3 điều kiện.** Thiếu 1 điều kiện = đứng ngoài.
2. **Không gỡ gạc.** Thua 2 lệnh liên tiếp = tắt máy ngay. Đây là quy tắc sắt, không phải đề xuất.
3. **Không dời SL ra xa.** SL đã đặt là SL. Vi phạm điều này là phá vỡ toàn bộ hệ thống quản trị rủi ro.
4. **Lock lãi theo đúng bảng.** Lãi +1.0đ → Khóa +0.6đ. Lãi +1.5đ → Khóa +1.0đ. Lãi +2.0đ → Lock +1.5đ.
5. **Ghi log mọi thứ.** Dữ liệu lệnh và bối cảnh quý hơn tiền.
6. **Không ôm vị thế qua đêm.** Tất cả đóng trước 14h28.
7. **Chấp nhận bỏ lỡ.** Bỏ lỡ sóng 10đ không mất gì. Đu đỉnh dính bẫy 1 lệnh mất cả tuần cày cuốc.

---

*Bản kế hoạch v4.0 này là luật tối cao của hệ thống. Viết bởi AI cho AI, hành động lạnh lùng như một kỹ sư cơ khí, đi lệnh chuẩn xác và có kỷ luật thép để kiếm cơm thực chiến hàng ngày.*

---
**v4.0** | Cập nhật: 2026-11-24 | Quant Predictive Positioning & Real-time Supply/Demand Execution
