import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { id: 'desc' }
    });
    return NextResponse.json({ products });
  } catch (error) {
    console.error('Failed to fetch products:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const data = await req.json();
    const { id, naverPrice, naverLink, coupangPrice, coupangLink, isManualOverride } = data;

    if (!id) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    const updatedProduct = await prisma.product.update({
      where: { id: Number(id) },
      data: {
        naverPrice: naverPrice !== undefined ? (naverPrice === '' ? null : Number(naverPrice)) : undefined,
        naverLink: naverLink !== undefined ? naverLink : undefined,
        coupangPrice: coupangPrice !== undefined ? (coupangPrice === '' ? null : Number(coupangPrice)) : undefined,
        coupangLink: coupangLink !== undefined ? coupangLink : undefined,
        isManualOverride: isManualOverride !== undefined ? isManualOverride : true,
      },
    });

    return NextResponse.json({ success: true, product: updatedProduct });
  } catch (error) {
    console.error('Failed to update product:', error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}
