function registerDiamondStoreRoutes({app,pool,current,notify,io,log,id,db,ownerOnly,auth}) {
  const packages = {
    starter: { price: 1, diamonds: 5000 },
    popular: { price: 2, diamonds: 12000 },
    royal: { price: 3, diamonds: 20000 },
    legendary: { price: 5, diamonds: 40000 }
  };

  async function ensureTable() {
    await pool.query("CREATE TABLE IF NOT EXISTS diamond_purchase_requests (id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, package_id TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0), diamonds BIGINT NOT NULL CHECK(diamonds > 0), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','granted','rejected')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL)");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS diamond_purchase_requests_pending_unique ON diamond_purchase_requests(user_id,package_id) WHERE status='pending'");
  }

  app.post('/api/shop/diamonds/request', auth, async (req, res) => {
    const user = current(req);
    const packageId = String(req.body?.packageId || '');
    const plan = packages[packageId];
    if (!plan) return res.status(400).json({ error: 'Choose a valid Diamond package.' });
    try {
      await ensureTable();
      const inserted = await pool.query("INSERT INTO diamond_purchase_requests(user_id,package_id,price,diamonds,status) VALUES($1,$2,$3,$4,'pending') RETURNING id", [Number(user.id), packageId, plan.price, plan.diamonds]);
      const owners = await pool.query("SELECT id FROM users WHERE LOWER(rank) IN ('owner','developer')");
      for (const owner of owners.rows) notify(owner.id, 'staff', 'Diamond purchase request', '@' + user.username + ' requested ' + plan.diamonds.toLocaleString() + ' Diamonds for $' + plan.price + '. Review it in Owner Space.');
      res.status(201).json({ ok: true, requestId: inserted.rows[0].id, message: 'Checkout request sent. Owner/Developer will review it after payment verification.' });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'You already have a pending request for this Diamond package.' });
      console.error('Diamond purchase request failed:', error);
      res.status(500).json({ error: 'Could not submit the Diamond purchase request.' });
    }
  });

  app.get('/api/owner/diamond-purchase-requests', ownerOnly, async (req, res) => {
    try {
      await ensureTable();
      const result = await pool.query("SELECT r.id,r.user_id,r.package_id,r.price,r.diamonds,r.status,r.created_at,u.username,u.rank FROM diamond_purchase_requests r JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.created_at ASC");
      res.json({ requests: result.rows });
    } catch (error) {
      console.error('Diamond purchase request list failed:', error);
      res.status(500).json({ error: 'Could not load Diamond purchase requests.' });
    }
  });

  app.post('/api/owner/diamond-purchase-requests/:id/grant', ownerOnly, async (req, res) => {
    const actor = current(req);
    const client = await pool.connect();
    let purchase;
    try {
      await ensureTable();
      await client.query('BEGIN');
      const found = await client.query("SELECT r.*,u.username FROM diamond_purchase_requests r JOIN users u ON u.id=r.user_id WHERE r.id=$1 AND r.status='pending' FOR UPDATE OF r", [req.params.id]);
      if (!found.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pending Diamond purchase request not found.' });
      }
      purchase = found.rows[0];
      const credited = await client.query("UPDATE users SET diamonds=COALESCE(diamonds,0)+$1 WHERE id=$2 RETURNING diamonds", [Number(purchase.diamonds), Number(purchase.user_id)]);
      if (!credited.rowCount) throw new Error('The requesting account no longer exists.');
      await client.query("INSERT INTO wallet_transactions(id,sender_id,recipient_id,currency,amount,type,note) VALUES($1,$2,$3,'DIAMONDS',$4,'DIAMOND_PURCHASE',$5)", [id(), Number(actor.id), Number(purchase.user_id), Number(purchase.diamonds), 'Diamond Store purchase - $' + Number(purchase.price)]);
      await client.query("UPDATE diamond_purchase_requests SET status='granted',reviewed_at=NOW(),reviewed_by=$2 WHERE id=$1", [purchase.id, Number(actor.id)]);
      await client.query('COMMIT');
      const target = db.users.find(item => Number(item.id) === Number(purchase.user_id));
      if (target) target.diamonds = Number(credited.rows[0].diamonds);
      io.to('user:' + purchase.user_id).emit('wallet:update', { userId: Number(purchase.user_id), diamonds: Number(credited.rows[0].diamonds), gold: Number(target?.gold || 0) });
      try { notify(purchase.user_id, 'wallet', 'Diamond purchase approved', 'Your purchase request was approved. ' + Number(purchase.diamonds).toLocaleString() + ' Diamonds have been added to your wallet.'); } catch (notifyError) { console.error('Diamond purchase notification failed:', notifyError); }
      try { log(actor, 'DIAMOND_PURCHASE_GRANTED', purchase.username, { requestId: Number(purchase.id), diamonds: Number(purchase.diamonds), price: Number(purchase.price) }); } catch (logError) { console.error('Diamond purchase audit log failed:', logError); }
      res.json({ ok: true, username: purchase.username, diamonds: Number(purchase.diamonds) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Diamond purchase grant failed:', error);
      res.status(500).json({ error: 'Could not grant Diamonds for this request.' });
    } finally {
      client.release();
    }
  });

  app.post('/api/owner/diamond-purchase-requests/:id/reject', ownerOnly, async (req, res) => {
    const actor = current(req);
    try {
      await ensureTable();
      const rejected = await pool.query("UPDATE diamond_purchase_requests SET status='rejected',reviewed_at=NOW(),reviewed_by=$2 WHERE id=$1 AND status='pending' RETURNING user_id,diamonds", [req.params.id, Number(actor.id)]);
      if (!rejected.rowCount) return res.status(404).json({ error: 'Pending Diamond purchase request not found.' });
      notify(rejected.rows[0].user_id, 'wallet', 'Diamond purchase request rejected', 'Your Diamond Store purchase request was rejected. No Diamonds were added.');
      log(actor, 'DIAMOND_PURCHASE_REJECTED', String(rejected.rows[0].user_id), { requestId: Number(req.params.id), diamonds: Number(rejected.rows[0].diamonds) });
      res.json({ ok: true });
    } catch (error) {
      console.error('Diamond purchase rejection failed:', error);
      res.status(500).json({ error: 'Could not reject the Diamond purchase request.' });
    }
  });
}

module.exports = { registerDiamondStoreRoutes };
