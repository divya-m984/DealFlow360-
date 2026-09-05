// OWNER: D2.  Product + Pricelist
// Phase 0 stub — created so this file is never created twice. See OWNERSHIP.md.
//
// This folder is SHARED: products/page.tsx is D3's (screen 16, the list),
// this [id]/page.tsx is D2's (screen 17, the detail).  Same directory,
// different files — that is what keeps git quiet.
export default function Page() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Product + Pricelist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Screen 17 — general info, variants (read-only), tier pricelists.
      </p>
      <p className="mt-4 text-xs text-muted-foreground">Owner: D2 · not built yet</p>
    </div>
  )
}
