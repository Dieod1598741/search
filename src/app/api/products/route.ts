import { NextRequest, NextResponse } from 'next/server';
import pool, { ensureProductSchema } from '@/lib/db';
import { normalizeCategory } from '@/lib/categories';

export async function GET(req: NextRequest) {
  try {
    await ensureProductSchema();
    const categoryParam = req.nextUrl.searchParams.get('category');

    if (categoryParam && categoryParam !== 'ALL') {
      const category = normalizeCategory(categoryParam);
      const { rows: products } = await pool.query(
        'SELECT * FROM "Product" WHERE category = $1 ORDER BY id DESC',
        [category]
      );
      return NextResponse.json({ products });
    }

    const { rows: products } = await pool.query('SELECT * FROM "Product" ORDER BY id DESC');
    return NextResponse.json({ products });
  } catch (error) {
    console.error('Failed to fetch products:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch products' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureProductSchema();
    const body = await req.json();

    // Supports both single item payload and batch `{ category, items: [...] }` payload
    const rawItems = Array.isArray(body.items) ? body.items : [body];
    const defaultCategory = normalizeCategory(body.category);

    const prepared: any[][] = [];
    for (const item of rawItems) {
      const name = item?.name ? String(item.name).trim() : '';
      if (!name) continue;

      const spec = item.spec ? String(item.spec).trim() : null;
      const barcode = item.barcode ? String(item.barcode).trim() : null;
      const supplier = item.supplier ? String(item.supplier).trim() : null;
      const currentPrice =
        item.currentPrice !== undefined && item.currentPrice !== '' && item.currentPrice !== null
          ? parseInt(String(item.currentPrice).replace(/[^0-9]/g, ''), 10) || 0
          : 0;
      const purchasePrice =
        item.purchasePrice !== undefined && item.purchasePrice !== '' && item.purchasePrice !== null
          ? parseInt(String(item.purchasePrice).replace(/[^0-9]/g, ''), 10) || 0
          : null;
      const category = item.category ? normalizeCategory(item.category) : defaultCategory;

      prepared.push([name, spec, barcode, supplier, purchasePrice, currentPrice, category]);
    }

    if (prepared.length === 0) {
      return NextResponse.json({ error: '상품명을 1개 이상 입력해주세요.' }, { status: 400 });
    }

    const valuesStr: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const row of prepared) {
      valuesStr.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(...row);
    }

    const query = `INSERT INTO "Product" (name, spec, barcode, supplier, "purchasePrice", "currentPrice", category) VALUES ${valuesStr.join(', ')} RETURNING *`;
    const { rows } = await pool.query(query, params);

    return NextResponse.json({ success: true, count: rows.length, products: rows, product: rows[0] });
  } catch (error) {
    console.error('Failed to create product(s):', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create product' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await ensureProductSchema();
    const data = await req.json();
    const {
      id,
      name,
      spec,
      supplier,
      category,
      naverPrice,
      naverLink,
      coupangPrice,
      coupangLink,
      isManualOverride,
      currentPrice,
    } = data;

    if (!id) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (name !== undefined && String(name).trim() !== '') {
      updates.push(`name = $${paramIdx++}`);
      values.push(String(name).trim());
    }
    if (spec !== undefined) {
      updates.push(`spec = $${paramIdx++}`);
      values.push(spec === '' ? null : String(spec).trim());
    }
    if (supplier !== undefined) {
      updates.push(`supplier = $${paramIdx++}`);
      values.push(supplier === '' ? null : String(supplier).trim());
    }
    if (category !== undefined) {
      updates.push(`category = $${paramIdx++}`);
      values.push(normalizeCategory(category));
    }
    if (currentPrice !== undefined) {
      updates.push(`"currentPrice" = $${paramIdx++}`);
      values.push(currentPrice === '' ? null : Number(currentPrice));
    }

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
    } else if (
      naverPrice !== undefined ||
      naverLink !== undefined ||
      coupangPrice !== undefined ||
      coupangLink !== undefined
    ) {
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
