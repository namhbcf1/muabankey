// Simulate getOrder payload -> showSuccess template access
const order = { id:"o1", code:"MBK-ABC", status:"delivered", subtotal:100000, discount:0, total:100000, createdAt:1, paidAt:2,
  items:[{productId:"p1",name:"Win11",unitPrice:100000,quantity:1,lineTotal:100000,keys:["AOE1-AAAA-BBBB-CCCC"]}] };
try {
  const html = `${order.delivered.map((d)=>d.name).join("")}`;
  console.log("NO ERROR:", html);
} catch (e) { console.log("THROWS:", e.constructor.name, "-", e.message); }
console.log("has 'delivered' prop:", 'delivered' in order);
console.log("keys of order:", Object.keys(order).join(","));

// Simulate router arg passing to mountCheckout
function mountCheckout(root, query = {}) { return { mode: (query.mode || ""), typeofQuery: typeof query, orderIdReceived: query }; }
const param = "ORD-123-uuid";
const routed = mountCheckout({}, param, { mode: "buynow" });
console.log("mountCheckout receives param as 2nd arg ->", JSON.stringify(routed));
