const API_BASE = process.env.API_BASE_URL || "http://localhost:5000/api/v1";
const MODEL = "google/gemini-2.5-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const systemInstruction = `You are a helpful POS assistant for Shwe-Pyi POS system.

CURRENT DATE: Today is ${new Date().toISOString().split("T")[0]}. The current year is ${new Date().getFullYear()}.

RULES:
- CRITICAL: Answer EXCLUSIVELY in Myanmar language (Burmese). NEVER use English, Arabic, Persian, Urdu, or any other language. Words like پرداخت, paid, total, amount, revenue, order are FORBIDDEN. Translate EVERYTHING into Myanmar.
- The POS system name is "Shwe-Pyi POS System". "i-max" is just a branch/location name, NOT the system name. NEVER refer to the system as "i-max POS".
- Use the available tools when the user asks about sales, product stock, purchase orders (PO), expenses, or product sales reports.
- Use getProductSalesReport when user asks about best-selling product, worst-selling product, or per-product sales quantity within a date range. The products array is sorted by totalQuantity descending (index 0 = best seller, last index = worst seller).
- When using getSalesReport: Both startDate and endDate are OPTIONAL. If user asks for a range (e.g. "this month", "May 1 to May 30"), include both startDate and endDate. If user asks for a specific date, use it as startDate only. If no date is mentioned, do NOT include any date parameter.
- If a tool returns empty data, say "ဒီအချိန်အတွင်း အချက်အလက်မရှိသေးပါ" (no data for this period).
- If the user asks something outside POS or no tool is available, say "ဒီအကြောင်းအရာအတွက် ကျွန်တော်မသိပါ၊ POS နဲ့ဆိုင်တဲ့အကြောင်းတွေပဲ ဖြေပေးနိုင်ပါတယ်" (I only answer POS-related questions).
- Be concise, professional, and friendly.
- Use proper Myanmar honorifics and sentence structure.
- Format currency amounts in MMK with commas (e.g. 150,000 MMK).
- If user greets (မင်္ဂလာပါ, ဟိုင်း, etc.), greet back in Myanmar.`;

function convertHistory(messages) {
  return messages.map((msg) => ({
    role: msg.role === "model" ? "assistant" : "user",
    content: msg.text,
  }));
}

async function apiGet(path, jwtToken) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: jwtToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `API error ${res.status}`);
  }
  const json = await res.json();
  return json.data;
}

const tools = [
  {
    type: "function",
    function: {
      name: "getSalesReport",
      description:
        "Get total sales amount for a date range. Both startDate and endDate are OPTIONAL. If the user specifies a range (e.g. 'May 1 to May 30'), use both startDate and endDate. If only one date is mentioned, use it as startDate (endDate defaults to same day). If no date is mentioned, do NOT include any date parameter.",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description:
              "OPTIONAL. Start date in YYYY-MM-DD format. Include when user mentions a date range.",
          },
          endDate: {
            type: "string",
            description:
              "OPTIONAL. End date in YYYY-MM-DD format. Include when user mentions a date range. If not provided, defaults to startDate (single day).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkStock",
      description: "Check remaining stock of a product by name or code.",
      parameters: {
        type: "object",
        properties: {
          productName: {
            type: "string",
            description: "Product name or code to search.",
          },
        },
        required: ["productName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getPOReport",
      description: "Get purchase order report within a date range.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date YYYY-MM-DD." },
          endDate: { type: "string", description: "End date YYYY-MM-DD." },
          status: {
            type: "string",
            description:
              "Filter: pending, confirmed, arrived, completed, cancelled.",
          },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getExpenseReport",
      description: "Get expense report within a date range.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date YYYY-MM-DD." },
          endDate: { type: "string", description: "End date YYYY-MM-DD." },
          category: { type: "string", description: "Filter by category." },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getProductSalesReport",
      description: "Get product-wise sales report within a date range. Use this when user asks about best-selling product, worst-selling product, or how many units of each product were sold. Returns products sorted by totalQuantity descending (best seller first).",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: "OPTIONAL. Start date YYYY-MM-DD. Defaults to today if not provided.",
          },
          endDate: {
            type: "string",
            description: "OPTIONAL. End date YYYY-MM-DD. Defaults to startDate if not provided.",
          },
        },
        required: [],
      },
    },
  },
];

const toolHandlers = {
  getSalesReport: async ({ startDate, endDate }, jwtToken) => {
    console.log("[Tool Call] getSalesReport with:", { startDate, endDate });
    let s, e;
    if (startDate) {
      s = new Date(startDate);
      if (isNaN(s.getTime()) || s.getFullYear() < 2026) s = new Date();
    } else {
      s = new Date();
    }
    if (endDate) {
      e = new Date(endDate);
      if (isNaN(e.getTime()) || e.getFullYear() < 2026) e = s;
    } else {
      e = s;
    }
    const sStr = s.toISOString().split("T")[0];
    const eStr = e.toISOString().split("T")[0];
    const data = await apiGet(
      `/sale-report?startDate=${sStr}&endDate=${eStr}`,
      jwtToken,
    );
    const r = data?.report || {};
    return {
      startDate: sStr,
      endDate: eStr,
      totalOrders: r.orderCount || 0,
      totalRevenue: r.finalAmount || 0,
      totalPaid: r.paidAmount || 0,
      creditCount: r.creditOrderCount || 0,
    };
  },
  checkStock: async ({ productName }, jwtToken) => {
    console.log("[Tool Call] checkStock with:", { productName });
    const searchData = await apiGet(
      `/inventory?search=${encodeURIComponent(productName)}&limit=1`,
      jwtToken,
    );
    const items = Array.isArray(searchData) ? searchData : searchData?.data || [];
    if (!items || items.length === 0) {
      return { found: false, message: `Product "${productName}" not found` };
    }
    const inv = items[0];
    const detail = await apiGet(`/inventory/${inv._id}`, jwtToken);
    return {
      found: true,
      productName: inv.productName,
      productCode: inv.productCode,
      totalStock:
        (detail?.totalWarehouseQuantity || 0) +
        (detail?.totalStorefrontQuantity || 0),
      unit: inv.unitOfMeasure,
      sellingPrice: inv.sellingPrice,
      warehouseStock: detail?.warehouseStockAvailability || [],
      storefrontStock: detail?.storefrontStockAvailability || [],
    };
  },
  getPOReport: async ({ startDate, endDate, status }, jwtToken) => {
    console.log("[Tool Call] getPOReport with:", { startDate, endDate, status });
    let path = `/purchase-report?startDate=${startDate}&endDate=${endDate}`;
    const data = await apiGet(path, jwtToken);
    const summary = data?.summary || {};
    let purchases = data?.purchases || [];
    if (status) {
      purchases = purchases.filter((p) => p.status === status);
    }
    return {
      totalPOs: summary.totalPOs || purchases.length,
      totalAmount: summary.totalAmount || 0,
      statusBreakdown: summary.statusBreakdown || {},
      pos: purchases.map((po) => ({
        poNumber: po.poNumber,
        supplier: po.supplierId?.supplierName || "Unknown",
        totalAmount: po.totalAmount,
        status: po.status,
      })),
    };
  },
  getExpenseReport: async ({ startDate, endDate, category }, jwtToken) => {
    console.log("[Tool Call] getExpenseReport with:", {
      startDate,
      endDate,
      category,
    });
    let path = `/expense?startDate=${startDate}&endDate=${endDate}`;
    if (category) path += `&category=${encodeURIComponent(category)}`;
    const data = await apiGet(path, jwtToken);
    const expenses = Array.isArray(data) ? data : data?.data || [];
    const categoryBreakdown = {};
    let total = 0;
    for (const exp of expenses) {
      const cat = exp.category || "Unknown";
      categoryBreakdown[cat] =
        (categoryBreakdown[cat] || 0) + (exp.amount || 0);
      total += exp.amount || 0;
    }
    return {
      totalExpenses: total,
      count: expenses.length,
      categoryBreakdown,
    };
  },
  getProductSalesReport: async ({ startDate, endDate }, jwtToken) => {
    console.log("[Tool Call] getProductSalesReport with:", {
      startDate,
      endDate,
    });
    let s, e;
    if (startDate) {
      s = new Date(startDate);
      if (isNaN(s.getTime()) || s.getFullYear() < 2026) s = new Date();
    } else {
      s = new Date();
    }
    if (endDate) {
      e = new Date(endDate);
      if (isNaN(e.getTime()) || e.getFullYear() < 2026) e = s;
    } else {
      e = s;
    }
    const sStr = s.toISOString().split("T")[0];
    const eStr = e.toISOString().split("T")[0];
    const data = await apiGet(
      `/sale-report/products?startDate=${sStr}&endDate=${eStr}`,
      jwtToken,
    );
    const products = data?.products || [];
    const totals = data?.totals || {};
    return {
      startDate: sStr,
      endDate: eStr,
      totalProducts: totals.totalUniqueProducts || 0,
      totalQuantity: totals.totalQuantity || 0,
      totalRevenue: totals.totalRevenue || 0,
      bestSeller: products.length > 0 ? products[0] : null,
      worstSeller: products.length > 0 ? products[products.length - 1] : null,
      products,
    };
  },
};

async function callOpenRouter(messages, opts = {}) {
  const { includeTools = true } = opts;
  const requestBody = { model: MODEL, messages };
  if (includeTools) {
    requestBody.tools = tools;
    requestBody.tool_choice = "auto";
  }

  const body = JSON.stringify(requestBody);
  console.log("--- API Request ---");
  console.log("Model:", MODEL);
  console.log(
    "Messages:",
    messages.length,
    "Tools:",
    includeTools ? tools.length : 0,
  );
  if (includeTools)
    console.log("Tool names:", tools.map((t) => t.function.name).join(", "));

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5000",
      "X-Title": "Shwe-Pyi POS",
    },
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    const rawError = data.error?.metadata?.raw || JSON.stringify(data);
    const errMsg = data.error?.message || `API error ${response.status}`;
    console.error("=== API ERROR ===");
    console.error("Status:", response.status);
    console.error("Error message:", errMsg);
    console.error("Raw error:", rawError);
    console.error("Request body (truncated):", body.substring(0, 500));
    throw new Error(errMsg);
  }

  return data;
}

async function runToolLoop(messages, jwtToken) {
  let msgs = messages;

  for (let step = 0; step < 5; step++) {
    console.log(`\n=== Step ${step} ===`);

    // Only send tools on the FIRST step. After that, no tools → model must respond with text.
    const data = await callOpenRouter(msgs, { includeTools: step === 0 });
    const choice = data.choices?.[0];
    const message = choice?.message;

    if (!message) {
      return "ဖြေဆိုရာတွင်အမှားရှိခဲ့ပါတယ်။ ပြန်ကြိုးစားပါ။";
    }

    console.log(`Finish reason: ${choice.finish_reason}`);
    if (message.content)
      console.log(`Content: ${message.content.substring(0, 100)}`);
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        console.log(`Tool call: ${tc.function.name}(${tc.function.arguments})`);
      }
    }

    // No tool calls — model responded with text
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || "ဖြေဆိုရာတွင်အမှားရှိခဲ့ပါတယ်။ ပြန်ကြိုးစားပါ။";
    }

    // Build assistant message
    const assistantMsg = {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.tool_calls,
    };

    // Execute all tool calls
    const toolMsgs = [];
    for (const tc of message.tool_calls) {
      const handler = toolHandlers[tc.function.name];
      if (!handler) {
        toolMsgs.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            error: `Unknown tool: ${tc.function.name}`,
          }),
        });
        continue;
      }
      try {
        const args = JSON.parse(tc.function.arguments);
        const result = await handler(args, jwtToken);
        toolMsgs.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
        console.log(
          `[Tool result] ${tc.function.name}:`,
          JSON.stringify(result).substring(0, 100),
        );
      } catch (err) {
        console.error(`Error in ${tc.function.name}:`, err.message);
        toolMsgs.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err.message }),
        });
      }
    }

    msgs = [...msgs, assistantMsg, ...toolMsgs];
  }

  return "တောင်းပန်ပါတယ်။ အဆင့်များလွန်းလို့ ပြန်မဖြေနိုင်တော့ပါ။ ထပ်မေးပေးပါ။";
}

export async function askGemini(messages, jwtToken) {
  const history = convertHistory(messages.slice(0, -1));
  const userMessage =
    messages.length > 0 ? messages[messages.length - 1].text : "";

  console.log("\n========== CHATBOT REQUEST ==========");
  console.log("User:", userMessage);

  const openaiMessages = [
    { role: "system", content: systemInstruction },
    ...history,
    { role: "user", content: userMessage },
  ];

  const reply = await runToolLoop(openaiMessages, jwtToken);

  console.log("Final reply:", reply?.substring(0, 200));
  console.log("=====================================\n");

  return reply;
}
