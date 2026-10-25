#!/bin/bash
echo "در حال اجرای باشگاه اردلان..."
xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null || echo "مرورگر را باز کنید: http://localhost:3000"
node server.js
