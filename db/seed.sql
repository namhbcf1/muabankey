-- ============================================================
-- MuaBanKey — Seed dữ liệu
-- ============================================================

DELETE FROM rate_limits;
DELETE FROM reviews;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM product_keys;
DELETE FROM products;
DELETE FROM categories;
DELETE FROM coupons;
DELETE FROM wallet_transactions;
DELETE FROM topups;
DELETE FROM sessions;
DELETE FROM audit_logs;
DELETE FROM users;

-- ---------- Danh mục ----------
INSERT INTO categories (id, slug, name, description, icon, sort_order, active, created_at) VALUES
('cat-win',    'windows-office',  'Windows & Office',  'Bản quyền Windows và Microsoft Office chính hãng, kích hoạt vĩnh viễn.', '🪟', 1, 1, 1731000000000),
('cat-ai',     'ai-tools',        'Công cụ AI',        'ChatGPT, Claude, Gemini, Perplexity - nâng cấp khả năng sáng tạo.',      '🤖', 2, 1, 1731000000000),
('cat-design', 'thiet-ke',        'Thiết kế & Sáng tạo', 'Adobe, Canva Pro, Figma - bộ công cụ cho nhà thiết kế chuyên nghiệp.', '🎨', 3, 1, 1731000000000),
('cat-stream', 'giai-tri',        'Giải trí & Streaming', 'Netflix, Spotify, YouTube Premium - giải trí không giới hạn.',        '🎬', 4, 1, 1731000000000),
('cat-dev',    'lap-trinh',       'Lập trình & Dev',   'GitHub Copilot, JetBrains, VPS - dành cho lập trình viên.',              '💻', 5, 1, 1731000000000),
('cat-secure', 'bao-mat',         'Bảo mật & VPN',     'Antivirus, VPN bảo vệ dữ liệu cá nhân của bạn.',                         '🛡️', 6, 1, 1731000000000);

-- ---------- Sản phẩm ----------
INSERT INTO products (id, slug, category_id, name, short_desc, description, image_url, badge, price, compare_price, delivery_type, stock_count, sold_count, rating, rating_count, warranty_days, duration_label, features, active, featured, sort_order, created_at, updated_at) VALUES
('p-win11', 'windows-11-pro', 'cat-win', 'Windows 11 Pro Retail', 'Khóa bản quyền vĩnh viễn, kích hoạt online chính chủ.', 'Bản quyền Windows 11 Professional Retail Key - kích hoạt trực tiếp qua Microsoft, gắn vĩnh viễn với tài khoản Microsoft của bạn. Hỗ trợ cập nhật chính thức, không giới hạn thời gian sử dụng.', 'https://images.unsplash.com/photo-1624571409108-e9a41746f484?w=800&q=80', 'HOT', 450000, 900000, 'key', 48, 1247, 4.9, 312, 365, 'Vĩnh viễn', '["Kích hoạt online chính hãng Microsoft","Gắn vĩnh viễn vào tài khoản Microsoft","Hỗ trợ cập nhật Windows Update","Không giới hạn thời gian sử dụng","Bảo hành 1 đổi 1 trong 365 ngày"]', 1, 1, 1, 1731000000000, 1731000000000),
('p-of2021', 'office-2021-pro-plus', 'cat-win', 'Office 2021 Pro Plus', 'Bộ Office trọn đời, bind tài khoản Microsoft.', 'Microsoft Office 2021 Professional Plus - bao gồm Word, Excel, PowerPoint, Outlook, Access, Publisher. Khóa Retail bind trực tiếp vào tài khoản Microsoft, không giới hạn thiết bị cá nhân.', 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=80', 'HOT', 390000, 790000, 'key', 62, 892, 4.8, 271, 365, 'Vĩnh viễn', '["Word, Excel, PowerPoint, Outlook, Access","Bind tài khoản Microsoft vĩnh viễn","Cài trên nhiều thiết bị cá nhân","Cập nhật chính thức từ Microsoft","Hỗ trợ Windows & macOS"]', 1, 1, 2, 1731000000000, 1731000000000),
('p-365', 'microsoft-365-family', 'cat-win', 'Microsoft 365 Family', '6 tài khoản, 1TB OneDrive mỗi người, 12 tháng.', 'Gói Microsoft 365 Family chính hãng - chia sẻ cho tối đa 6 người dùng, mỗi người có 1TB OneDrive và full bộ ứng dụng Office trên mọi thiết bị. Thời hạn 12 tháng.', 'https://images.unsplash.com/photo-1633419461186-7d40a38105ec?w=800&q=80', 'NEW', 690000, 1490000, 'account', 25, 418, 4.9, 156, 365, '12 tháng', '["6 tài khoản riêng biệt","1TB OneDrive mỗi tài khoản","Full Office trên PC/Mac/Mobile","Teams, Outlook, Copilot cơ bản","Gia hạn hàng năm"]', 1, 1, 3, 1731000000000, 1731000000000),
('p-chatgpt', 'chatgpt-plus', 'cat-ai', 'ChatGPT Plus', 'GPT-5, o1 pro, ưu tiên truy cập, không giới hạn.', 'Tài khoản ChatGPT Plus chính thức - truy cập GPT-5, o1-pro, DALL·E 4, Sora và các mô hình mới nhất với tốc độ ưu tiên. Không giới hạn tin nhắn trong giờ cao điểm.', 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&q=80', 'HOT', 290000, 590000, 'account', 87, 2103, 4.9, 687, 30, '1 tháng', '["Truy cập GPT-5 & o1-pro","DALL·E 4 tạo ảnh AI","Sora video generation","Ưu tiên truy cập giờ cao điểm","Kèm tài khoản email riêng"]', 1, 1, 4, 1731000000000, 1731000000000),
('p-claude', 'claude-pro', 'cat-ai', 'Claude Pro', 'Claude Sonnet 4.5, Opus, 5x usage.', 'Tài khoản Claude Pro chính hãng từ Anthropic - truy cập Claude Sonnet 4.5, Opus với hạn mức gấp 5 lần bản miễn phí. Xử lý tài liệu dài, viết code, phân tích dữ liệu chuyên sâu.', 'https://images.unsplash.com/photo-1655720828018-edd2daec9349?w=800&q=80', null, 280000, 580000, 'account', 54, 876, 4.8, 234, 30, '1 tháng', '["Claude Sonnet 4.5 & Opus","5x hạn mức sử dụng","Phân tích tài liệu dài","Artifacts & Projects","Ưu tiên truy cập"]', 1, 1, 5, 1731000000000, 1731000000000),
('p-gemini', 'gemini-advanced', 'cat-ai', 'Google Gemini Advanced', 'Gemini Ultra + 2TB Google One.', 'Gói Google One AI Premium - truy cập Gemini Advanced (Ultra 1.0), 2TB lưu trữ Google Drive, tích hợp sâu vào Gmail, Docs, Sheets.', 'https://images.unsplash.com/photo-1675557009875-436f71457475?w=800&q=80', null, 220000, 450000, 'account', 30, 512, 4.7, 143, 30, '1 tháng', '["Gemini Advanced (Ultra)","2TB Google Drive","Tích hợp Gmail & Docs","Google Meet Pro","Không quảng cáo"]', 1, 0, 6, 1731000000000, 1731000000000),
('p-perplexity', 'perplexity-pro', 'cat-ai', 'Perplexity Pro', 'AI search không giới hạn, 300+ Pro searches/ngày.', 'Tài khoản Perplexity Pro - công cụ tìm kiếm AI trích dẫn nguồn, sử dụng GPT-5, Claude Sonnet 4.5, Grok. 300 câu hỏi Pro mỗi ngày.', 'https://images.unsplash.com/photo-1655720033654-a4239dd42d1c?w=800&q=80', null, 180000, 380000, 'account', 41, 389, 4.7, 98, 30, '1 tháng', '["300+ Pro searches/ngày","Đa mô hình AI (GPT-5, Claude)","Upload file PDF/ảnh","Sinh ảnh AI","Không quảng cáo"]', 1, 0, 7, 1731000000000, 1731000000000),
('p-adobe', 'adobe-creative-cloud', 'cat-design', 'Adobe Creative Cloud', 'Full 20+ app, 100GB cloud, 12 tháng.', 'Adobe Creative Cloud All Apps chính hãng - Photoshop, Illustrator, Premiere Pro, After Effects, Lightroom và hơn 20 ứng dụng chuyên nghiệp. 100GB lưu trữ đám mây.', 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=800&q=80', 'HOT', 890000, 1800000, 'account', 18, 634, 4.8, 201, 365, '12 tháng', '["20+ ứng dụng Adobe","Photoshop, Illustrator, Premiere","100GB Creative Cloud","Adobe Fonts Premium","Adobe Firefly AI"]', 1, 1, 8, 1731000000000, 1731000000000),
('p-canva', 'canva-pro', 'cat-design', 'Canva Pro', 'Team 1 người, 100GB, 12 tháng.', 'Canva Pro chính hãng - truy cập toàn bộ template Premium, 100GB lưu trữ, Magic Studio AI, xóa nền, Brand Kit. Thiết kế chuyên nghiệp không cần Photoshop.', 'https://images.unsplash.com/photo-1626785774625-0b1c2c4eab67?w=800&q=80', 'NEW', 240000, 490000, 'key', 73, 1520, 4.8, 412, 180, '12 tháng', '["100+ triệu template Premium","Magic Studio AI","Xóa nền tự động","100GB lưu trữ","Brand Kit & Mockup"]', 1, 0, 9, 1731000000000, 1731000000000),
('p-figma', 'figma-professional', 'cat-design', 'Figma Professional', 'Team không giới hạn file, design system.', 'Figma Professional chính hãng - không giới hạn file và lịch sử phiên bản, component library, design system chuyên nghiệp, Figma AI.', 'https://images.unsplash.com/photo-1618788372246-79faff0c3742?w=800&q=80', null, 320000, 640000, 'account', 12, 198, 4.7, 67, 90, '12 tháng', '["Không giới hạn file","Lịch sử phiên bản vô hạn","Design system & Components","Figma AI Beta","Dev Mode"]', 1, 0, 10, 1731000000000, 1731000000000),
('p-netflix', 'netflix-premium', 'cat-stream', 'Netflix Premium 4K', 'Gói Premium 4K, 1 profile riêng, 1 tháng.', 'Tài khoản Netflix Premium - chất lượng 4K HDR, 1 profile riêng tư có mật khẩu, xem 1 thiết bị cùng lúc. Không lo bị kick, bảo hành đổi mới trong suốt thời hạn.', 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=800&q=80', 'HOT', 95000, 260000, 'account', 156, 4821, 4.7, 1203, 30, '1 tháng', '["Chất lượng 4K HDR","1 profile riêng có mật khẩu","Không bị kick khi đang xem","Hỗ trợ mọi thiết bị","Đổi mới nếu lỗi"]', 1, 1, 11, 1731000000000, 1731000000000),
('p-spotify', 'spotify-premium', 'cat-stream', 'Spotify Premium', 'Nghe nhạc không quảng cáo, 1 tháng.', 'Tài khoản Spotify Premium nâng cấp chính chủ trên email của bạn - nghe nhạc chất lượng cao 320kbps, tải offline, bỏ qua bài hát không giới hạn.', 'https://images.unsplash.com/photo-1611339555312-e607c8352fd7?w=800&q=80', null, 75000, 149000, 'account', 98, 2870, 4.8, 812, 30, '1 tháng', '["Nâng cấp trên email riêng của bạn","Chất lượng cao 320kbps","Tải nhạc offline","Bỏ quảng cáo hoàn toàn","Bỏ qua bài không giới hạn"]', 1, 0, 12, 1731000000000, 1731000000000),
('p-yt', 'youtube-premium', 'cat-stream', 'YouTube Premium', 'Không quảng cáo + YouTube Music, 12 tháng.', 'YouTube Premium chính hãng 12 tháng - xem video không quảng cáo, nghe nền khi tắt màn hình, tải video offline, kèm YouTube Music Premium.', 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&q=80', 'SALE', 550000, 990000, 'account', 34, 1092, 4.8, 387, 365, '12 tháng', '["Không quảng cáo toàn bộ","Tải video offline","Nghe nền tắt màn hình","YouTube Music Premium","Kích hoạt trên email riêng"]', 1, 0, 13, 1731000000000, 1731000000000),
('p-copilot', 'github-copilot', 'cat-dev', 'GitHub Copilot', 'AI code assistant, gợi ý code thông minh.', 'GitHub Copilot Pro - trợ lý lập trình AI mạnh nhất, gợi ý code theo ngữ cảnh, chat trong IDE, hỗ trợ VS Code, JetBrains, Neovim. Sử dụng GPT-5 và Claude.', 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&q=80', 'HOT', 210000, 420000, 'account', 47, 723, 4.9, 245, 30, '1 tháng', '["Gợi ý code thông minh","Chat trong IDE","Hỗ trợ VS Code/JetBrains","Mô hình GPT-5 & Claude","Không giới hạn gợi ý"]', 1, 1, 14, 1731000000000, 1731000000000),
('p-jetbrains', 'jetbrains-all-products', 'cat-dev', 'JetBrains All Products', 'IntelliJ, PyCharm, WebStorm - full pack.', 'JetBrains All Products Pack chính hãng - truy cập toàn bộ IDE: IntelliJ IDEA Ultimate, PyCharm Pro, WebStorm, PhpStorm, DataGrip, GoLand và hơn 10 công cụ khác.', 'https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=800&q=80', null, 780000, 1600000, 'account', 9, 156, 4.8, 54, 365, '12 tháng', '["10+ IDE chuyên nghiệp","IntelliJ IDEA Ultimate","PyCharm & WebStorm","DataGrip & GoLand","AI Assistant tích hợp"]', 1, 0, 15, 1731000000000, 1731000000000),
('p-vpn', 'expressvpn', 'cat-secure', 'ExpressVPN', 'Bảo mật cấp quân đội, 90 quốc gia.', 'ExpressVPN chính hãng - mã hóa AES-256, 3000+ server tại 90+ quốc gia, không giới hạn băng thông, tốc độ cao, bảo vệ mọi thiết bị.', 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&q=80', 'NEW', 320000, 640000, 'key', 52, 934, 4.7, 287, 365, '12 tháng', '["3000+ server toàn cầu","Mã hóa AES-256","Không giới hạn băng thông","Hỗ trợ 5 thiết bị","Không lưu log"]', 1, 0, 16, 1731000000000, 1731000000000),
('p-antivirus', 'kaspersky-plus', 'cat-secure', 'Kaspersky Plus', 'Antivirus + VPN + Password Manager.', 'Kaspersky Plus chính hãng - bảo vệ toàn diện với antivirus, firewall, VPN không giới hạn, password manager và kiểm tra rò rỉ dữ liệu.', 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&q=80', null, 260000, 520000, 'key', 28, 412, 4.6, 121, 365, '12 tháng', '["Antivirus đa lớp","VPN không giới hạn","Password Manager","Kiểm tra rò rỉ dữ liệu","Hỗ trợ 3 thiết bị"]', 1, 0, 17, 1731000000000, 1731000000000),
('p-wps', 'wps-office-pro', 'cat-win', 'WPS Office Pro', 'Thay thế Office giá rẻ, tương thích 100%.', 'WPS Office Pro chính hãng - bộ ứng dụng văn phòng tương thích hoàn toàn Microsoft Office, nhẹ hơn, miễn phí cập nhật, tích hợp AI viết văn bản.', 'https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&q=80', 'SALE', 120000, 300000, 'key', 67, 1045, 4.6, 298, 365, 'Vĩnh viễn', '["Tương thích 100% MS Office","Nhẹ và nhanh hơn","AI Writer tích hợp","Kích hoạt vĩnh viễn","Hỗ trợ Windows/Mac/Android"]', 1, 0, 18, 1731000000000, 1731000000000);

-- ---------- Kho key mẫu ----------
INSERT INTO product_keys (id, product_id, secret, note, status, created_at) VALUES
('k-win11-001','p-win11','MTEwMDAwLTExMjIzMy00NDU1NjYtNzg4OTkw','Key Retail B2C','available',1731000000000),
('k-win11-002','p-win11','MTEwMDAwLTExMjIzMy00NDU1NjctNzg4OTkx','Key Retail B2C','available',1731000000000),
('k-win11-003','p-win11','MTEwMDAwLTExMjIzMy00NDU1NjgtNzg4OTky','Key Retail B2C','available',1731000000000),
('k-win11-004','p-win11','MTEwMDAwLTExMjIzMy00NDU1NjktNzg4OTkz','Key Retail B2C','available',1731000000000),
('k-win11-005','p-win11','MTEwMDAwLTExMjIzMy00NDU1NTcwLTc4ODk5NA==','Key Retail B2C','available',1731000000000),
('k-of-001','p-of2021','T0ZGSUNFMjAyMS1QTFVTLUE3QjNDLTlEMkVG','Key Office 2021','available',1731000000000),
('k-of-002','p-of2021','T0ZGSUNFMjAyMS1QTFVTLUE3QjNELTlEMkVH','Key Office 2021','available',1731000000000),
('k-of-003','p-of2021','T0ZGSUNFMjAyMS1QTFVTLUE3QjNFLTlEMkVJ','Key Office 2021','available',1731000000000),
('k-wps-001','p-wps','V1BTLVBSTy1LS0s0LTI4ODgtOTk5OQ==','Key WPS Pro','available',1731000000000),
('k-wps-002','p-wps','V1BTLVBSTy1LS0s1LTI4ODktOTk5OA==','Key WPS Pro','available',1731000000000),
('k-vpn-001','p-vpn','RVhQUkVTU1ZQTi1ZRUFSTFktUExBTi0yMDI15','Thẻ kích hoạt ExpressVPN 12 tháng','available',1731000000000),
('k-vpn-002','p-vpn','RVhQUkVTU1ZQTi1ZRUFSMlotUExBTi0yMDI25','Thẻ kích hoạt ExpressVPN 12 tháng','available',1731000000000),
('k-av-001','p-antivirus','S0FTU1BFUlNLLVBQTC1QTEFOLUtFWTQ0','Mã kích hoạt Kaspersky','available',1731000000000),
('k-canva-001','p-canva','Q0FOVkEtUFJPLUtFWS0yMDI1LTQ0NDQ=','Mã kích hoạt Canva Pro','available',1731000000000),
('k-canva-002','p-canva','Q0FOVkEtUFJPLUtFWS0yMDI1LTU1NTU=','Mã kích hoạt Canva Pro','available',1731000000000);

-- Đồng bộ tồn kho theo số key thực tế
UPDATE products SET stock_count = (SELECT COUNT(*) FROM product_keys k WHERE k.product_id = products.id AND k.status='available');

-- ---------- Tài khoản: xem db/accounts.sql (hash PBKDF2 thật) ----------

-- ---------- Mã giảm giá ----------
INSERT INTO coupons (id,code,type,value,min_subtotal,max_discount,usage_limit,used_count,starts_at,expires_at,active,created_at) VALUES
('c1','WELCOME10','percent',10,200000,100000,1000,0,1731000000000,1893456000000,1,1731000000000),
('c2','GIAM50K','fixed',50000,300000,NULL,500,0,1731000000000,1893456000000,1,1731000000000),
('c3','KEYVIP20','percent',20,500000,300000,100,0,1731000000000,1893456000000,1,1731000000000);

-- ---------- Đánh giá: xem db/accounts.sql (cần user tồn tại trước) ----------

-- ---------- Cài đặt ----------
INSERT INTO settings (key,value,updated_at) VALUES
('bank_name','MB Bank',1731000000000),
('bank_account','0000000000',1731000000000),
('bank_owner','BANG A CHIEU',1731000000000),
('topup_min','20000',1731000000000),
('topup_max','50000000',1731000000000),
('auto_deliver','1',1731000000000);
