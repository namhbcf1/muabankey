SELECT id, email, username, role, status, length(password_hash) AS hlen, balance FROM users ORDER BY email;
