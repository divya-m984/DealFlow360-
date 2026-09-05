// OWNER: D1.  Customer Portal — Negotiation (screen 11)
// Phase 0 stub — created so this file is never created twice. See OWNERSHIP.md.
//
// ADDRESSED BY public_id (uuid), NEVER by the integer id.
// A portal user must not be able to reach another customer's quotation by
// incrementing a number in the URL.  middleware.ts keeps internal users out of
// the portal entirely; this is the other half — row scoping WITHIN the portal.
//
// The handler behind this page must still re-check
//   session.customerId === quotation.customer_id
// on every request.  The uuid makes enumeration impractical; it is not
// authorisation on its own.
export default async function Page({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">My Quotation</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Screen 11 — line comments, counter discount, requested delivery date.
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        Owner: D1 · not built yet · quotation {publicId}
      </p>
    </div>
  )
}
