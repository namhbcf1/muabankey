function parseRoute(hashIn) {
  const hash = hashIn.slice(1) || "/";
  const [beforeQuery, anchor = ""] = hash.split("#");
  const [pathPart, queryPart] = beforeQuery.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ""));
  return { path: "/" + segments.join("/"), query, anchor };
}
// History: guest clicks "Mua ngay" -> navigate('/login?redirect=/checkout?mode=buynow')
console.log("A)", JSON.stringify(parseRoute("#/login?redirect=/checkout?mode=buynow")));
// 3-part path
console.log("B)", JSON.stringify(parseRoute("#/order/ORD-123")));
console.log("C)", JSON.stringify(parseRoute("#/checkout?mode=buynow")));
