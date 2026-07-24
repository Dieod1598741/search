import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    const { rows: products } = await pool.query('SELECT * FROM "Product" ORDER BY id DESC');
    return NextResponse.json({ products });
  } catch (error) {
    console.error('Failed to fetch products:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch products' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const data = await req.json();
    const { id, naverPrice, naverLink, coupangPrice, coupangLink, isManualOverride } = data;

    if (!id) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (naverPrice !== undefined) {
      updates.push(`"naverPrice" = $${paramIdx++}`);
      values.push(naverPrice === '' ? null : Number(naverPrice));
    }
    if (naverLink !== undefined) {
      updates.push(`"naverLink" = $${paramIdx++}`);
      values.push(naverLink);
    }
    if (coupangPrice !== undefined) {
      updates.push(`"coupangPrice" = $${paramIdx++}`);
      values.push(coupangPrice === '' ? null : Number(coupangPrice));
    }
    if (coupangLink !== undefined) {
      updates.push(`"coupangLink" = $${paramIdx++}`);
      values.push(coupangLink);
    }
    if (isManualOverride !== undefined) {
      updates.push(`"isManualOverride" = $${paramIdx++}`);
      values.push(isManualOverride);
    } else {
      updates.push(`"isManualOverride" = $${paramIdx++}`);
      values.push(true);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }

    values.push(Number(id));
    const query = `UPDATE "Product" SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`;
    
    const { rows } = await pool.query(query, values);

    return NextResponse.json({ success: true, product: rows[0] });
  } catch (error) {
    console.error('Failed to update product:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update product' }, { status: 500 });
  }
}
