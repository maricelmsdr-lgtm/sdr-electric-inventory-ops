"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ShoppingCart, Building2, Warehouse, Calendar, FileText, Package,
  PackageCheck, Check, RotateCcw, Mail, FileDown, Copy, Pencil, Trash2, DollarSign,
  User,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, money, PrimaryBtn, ModalShell, inputCls, ConfirmModal, IconBtn } from "@/components/ui";

const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");

const STATUSES = ["Open", "Ordered", "Received", "Cancelled"];
const STATUS_STYLES = {
  Open: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};

const TABS = [
  { key: "lines", label: "Purchase Lines" },
  { key: "received", label: "Received Items" },
  { key: "returns", label: "Returns" },
];

export default function PODetailPage() {
  return (
    <Suspense fallback={<Nav title="Purchase Order"><div className="p-6 text-sm text-slate-500 f-mono uppercase tracking-widest">Loading...</div></Nav>}>
      <PODetailPageInner />
    </Suspense>
  );
}

function PODetailPageInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const poId = params?.id;

  const [orgId, setOrgId] = useState(null);
  const [user, setUser] = useState(null);
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [tab, setTab] = useState("lines");
  const [comingSoon, setComingSoon] = useState(null); // { label } for the toast/notice
  const [attachments, setAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();
      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  useEffect(() => {
    if (!orgId || !poId) return;
    fetchPO();
  }, [orgId, poId]);

  // "Save & Send" in the create/edit wizard redirects here with
  // ?email=1 -- open the Send Email modal automatically once the PO
  // has loaded, then strip the param so a page refresh doesn't
  // re-open it.
  useEffect(() => {
    if (po && searchParams.get("email") === "1") {
      setEmailModalOpen(true);
      router.replace(`/purchase-orders/${poId}`);
    }
  }, [po]);

  const fetchPO = async () => {
    setLoading(true);
    setError("");

    const { data, error: err } = await supabase
      .from("purchase_orders")
      .select("*, po_line_items(*, parts(part_no, sku, description)), locations(name, type), jobs(job_no, client)")
      .eq("id", poId)
      .eq("org_id", orgId)
      .single();

    if (err) setError(err.message);
    setPo(data || null);
    setLoading(false);
    fetchAttachments();
  };

  const fetchAttachments = async () => {
    const { data } = await supabase
      .from("po_attachments")
      .select("*")
      .eq("po_id", poId)
      .order("created_at", { ascending: false });
    setAttachments(data || []);
  };

  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB, matches the UI copy
  const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png"];

  const uploadAttachment = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`"${file.name}" isn't a supported file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG.`);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`"${file.name}" is over the 10MB limit.`);
      return;
    }

    setUploadingFile(true);
    setError("");
    try {
      const path = `${orgId}/${poId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("po-attachments").upload(path, file);
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("po_attachments").insert({
        org_id: orgId,
        po_id: poId,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        uploaded_by: user?.id || null,
      });
      if (insErr) throw insErr;

      await logActivity(`Attached "${file.name}" to PO ${po.po_no}`);
      fetchAttachments();
    } catch (e) {
      setError(e.message || "Could not upload the file.");
    } finally {
      setUploadingFile(false);
    }
  };

  const deleteAttachment = async (att) => {
    setError("");
    const { error: storageErr } = await supabase.storage.from("po-attachments").remove([att.file_path]);
    if (storageErr) { setError(storageErr.message); return; }
    const { error: rowErr } = await supabase.from("po_attachments").delete().eq("id", att.id);
    if (rowErr) { setError(rowErr.message); return; }
    fetchAttachments();
  };

  const attachmentUrl = (path) =>
    supabase.storage.from("po-attachments").getPublicUrl(path).data.publicUrl;

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  /*
   * =========================================================
   * STATUS CHANGE (Open / Ordered / Cancelled only)
   * =========================================================
   *
   * "Received" is no longer settable directly from here -- it's
   * driven by actually receiving line items (Receive Products
   * modal below), which auto-sets status to Received once every
   * line is fully received.
   */

  const changeStatus = async (newStatus) => {
    if (!po || newStatus === po.status) return;
    setStatusSaving(true);
    setError("");
    try {
      const { error: updErr } = await supabase
        .from("purchase_orders")
        .update({ status: newStatus })
        .eq("id", po.id);
      if (updErr) throw updErr;
      await fetchPO();
    } catch (e) {
      setError(e.message || "Could not update status.");
    } finally {
      setStatusSaving(false);
    }
  };

  /*
   * =========================================================
   * CLONE — duplicates this PO (header + line items) as a new
   * Open PO with a fresh sequential number, today's date, and
   * qty_received reset to 0. Everything else (vendor, delivery
   * location, notes, line items/prices) carries over.
   * =========================================================
   */

  const clonePO = async () => {
    if (!po) return;
    setCloning(true);
    setError("");
    try {
      const { count } = await supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);
      const newPoNo = `PUR-${1000 + (count || 0)}`;

      const { data: newPo, error: insErr } = await supabase
        .from("purchase_orders")
        .insert({
          org_id: orgId,
          po_no: newPoNo,
          vendor: po.vendor,
          vendor_id: po.vendor_id,
          job_id: po.job_id,
          delivery_location_id: po.delivery_location_id,
          po_date: new Date().toISOString().slice(0, 10),
          delivery_date: null,
          notes: po.notes,
          status: "Open",
        })
        .select()
        .single();
      if (insErr) throw insErr;

      const lineRows = (po.po_line_items || []).map((li) => ({
        po_id: newPo.id,
        part_id: li.part_id,
        qty: li.qty,
        unit_cost: li.unit_cost,
      }));
      if (lineRows.length) {
        const { error: liErr } = await supabase.from("po_line_items").insert(lineRows);
        if (liErr) throw liErr;
      }

      await logActivity(`Cloned PO ${po.po_no} → ${newPoNo}`);
      router.push(`/purchase-orders/${newPo.id}`);
    } catch (e) {
      setError(e.message || "Could not clone this PO.");
    } finally {
      setCloning(false);
    }
  };

  const deletePO = async () => {
    if (!po) return;
    const { error: delErr } = await supabase.from("purchase_orders").delete().eq("id", po.id);
    if (delErr) { setError(delErr.message); setConfirmDelete(false); return; }
    await logActivity(`Deleted PO ${po.po_no}`);
    router.push("/purchase-orders");
  };

  const flagComingSoon = (label) => {
    setComingSoon(label);
    setTimeout(() => setComingSoon(null), 2500);
  };

  /*
   * =========================================================
   * PDF EXPORT — browser print-to-PDF, no external library or
   * service needed. Opens a plain, print-styled window with just
   * the PO content; the browser's own "Save as PDF" print
   * destination produces the actual file.
   * =========================================================
   */

  const exportPdf = () => {
    if (!po) return;
    // Company logo embedded as base64 so the print/PDF window has no
    // dependency on external image hosting.
    const LOGO_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAO4AAACNCAIAAAA/7NGBAAAQAElEQVR4AeydB3wU1fbHJ9lNJSQECKGEDqEGBQMomqAi+LDQRAUREUUFRUCfCAoiTZ+IBSkiin+K+AgWQBBUEJ7SFIjwCC2ACKEIhBISUslu8v/O3N3ZyWaz2SSbxhs+JzfnnnvOuXfO/ObMmTubxTNX/6dH4IaIgKek/9MjcENEQIfyDXEa9YOQJB3KOgpukAjoUL5BTqR+GDqUdQwoEaj8jQ7lyn8O9SNQIqBDWQmD3lT+COhQrvznUD8CJQI6lJUw6E3lj4AO5cp/DvUjUCKgQ1kJQ0kb3b78I6BDufzPgb4Ct0RAh7Jbwqg7Kf8I6FAu/3Ogr8AtEdCh7JYw6k7KPwI6lMv/HOgrcEsEKgSUnRxJRmamk1F9SI+AGoEKDWVwPGXq5A0bN6jL1Rk9AgVFoEJDeevWLeB43sfz/j73d0EHoMv1CIgIVFwoA9/3PngvLS0t/kj8Zws/M5lzxIr1Vo+AwwhUUChTWgDfM2fOiEWvW79u8+afBa+3egQcRqCCQjk2dvd3a74zm81i0cnJySA7KSlJdPX2Bo1AiQ6rIkKZ0mL2nNmUFtojO3jo4MLPF5o0ZYaW12rq/P9mBCoilFetWgVw7c6H2Wxeu27tnj9iVbkp+7pkziwqmXNyVQ86cyNFoMJBeV/cvnnz5wHc/FG+cOHCzPdnUkaLIV/Pa1mbR2at7+QqXd0hGXwNnh7CXG9vsAhULChTDc+ZO0fFscFg6NG9R2hoqBp0snVMzPKULLmGNv21Njfxm9yUU66QZ/0on6oRqh+dufEiULGgvPq71Tt+26FGOSws7OUxL48YPsLX11cIQfmiJYviYn8zpRwxH5slhIW2nvXae7WebDbWLFRTV6i8EahAUGb/GJgCVhFNUvLI50c2bty4T+++0VHRQkiLQlD1IPPOmSRjuoWSR2CD3Ig3MnOq3vClRaGhuLEVKgqUqYAXL1l86dIlNdzd7u7WvXsPun6+vi88/4JaZgx7fngrj92UFgy5QobmY3xq3G308nZFWdepvBGoKFBe/d2qVatXkXFFKAEu8AXE6/977vSl9JYtWooyo22btoPv6+R6aWFoM8jY/DF8Gg0V5UhZjE6lEYEKcYJPnDgRExOjHh6lxdAhQ4EvIJ4aEzdj9cGULDNlxk033fTAQ31y/5rtYmlhKZE9fFTPOnMDR6BCQHnBZwuO/XlMjXJkZGSf3n1M5hxAvP/klRXbTm47nEiG/nT+p491r2c++KWq6YShRPbs8IleIjsJ0Q02VP5Q3rBxw5q1a8zWd9RVqlR5ffzrwcHBG/ZfAMSEOz3TRG7m1QYbyR77pyFxhSiRjYHheonsSqxuDJ1yhjLvqD9b+JmKY0qLgY8OpLS4mHod+AJiEeXj51OWbjnJRnLO2b1C4ry1lsgeRSiRnXvURyt8BMoZyuA4bn+cGqX2N7cfNGiQyZwzJWYfpYUqv6vvLY9FnDAdflmVOGE8avVnF5kXe0509KEbLwLlCeVdu3atW79OjSmlxfDnhtetU5fS4vtdlo93Mhre2PuN8DRpz7+ldHqFECWy1OExSuRC9PThGy4C5QZl3lHPfH9mcnKyCCmlRe9evSMjO2ZkZlJaXEzJFHLaUfd2aCU2kv3pSZKTlqEus3xq3KW+HVQM9OZ/IgLlA2VKiH8v//fBQwfVGPOO+plhz3h5eS/4+aSttDAaSMmDO1yXN5KBKdq05GZaR7yh8SCDVz3p+iXp+kVXyWy7ZnCpU+WNQPlA+eDB/Su+XmG27lqQRHlHTWlx6Fzqxxv+tEUzwPfNx26TN5JNp2xCgWPRz8vnnN6as2f49R2PuEI8ROLDrO86E4UbgtwF5SIEgxJi+lvTL1y4oNr069uve/ceKVnmcYv/OJt4TZW/3Kd1z7rx5hMubSRjlWs6lZO01xXyqNba2ORByTvEoH/mk8DdEFQOUOYdtXbXIigoiNKCNyDfxZ6N/VP5DIbRICmlxYhIT9c3kiUvV08IdQhbHPoH5VyNVyXRK2soxx+Jn//JfDU4lBYvjXmJ0iLuTMq0FXHpplxALI8qpUXImfdzUvfKGAWmhRJmhep4SSqOneRjkzmHjW1em5ecWJROZROBMoUypcW8j+dpP/4WHRXdp3dfSosZqw+dvcIDnZTrZYTu79mW0oLa171RMIQNEvnYDsdgF9R+sf3UyIW7e07/zx0TNt71+k89p24qOd06/icc4hbnXK5MlP+I1v/3XLs3NjukDu/9XgT65L8dHNHD3x6D/vnzqU9iL2w/cTXhWrbDZTDUfclBhx5cEha21B4fxw6a+/vEr/aLUJAs8oeiJJIyhfLGjRu2bN1itj7tUVqIj79RWmyIPc1hAGLaFrVzZ90uUVrkeidIXrnuooJwDIjHLPqj29TNw+dsX/Tzn1sOnGcL5URiqlsIVzjELc57Td3ERACaY9TS5bTsP89cPX4xVaVjSZmCDp+8YqEzyYfPJB86d81CiemHoMuZhwRdvX4IOpNy8FyqhRLTD1ppzZEr0Nxd50ZvOHn38iN9vzw47j9nALR2DfDXPA17L2UcSDGpdPBKFjxtHrK6lf1bpzvE1NdM8hrEemhZniBlzYfPJG89evnbE9fe3/H3s8sPdJ21c9DSuFnfx7sR0GUH5RMnTrz3wXuZ1u+AYyN5xHMjmjULP30pXZQWAsfElF2LEPPSnKw98O4iQ+jj5OP8z3lkxKjXfwJq2sdNd01q54fN8hXbTnab+BOTmjR/Om6nlqfLYwN9pc01KCfLYJAghJaupyQYSbIoqEMwkGLLb5VAJ7C+M+bojwm2J2wx6uGb51PduflsZTWtUDO1hzgiJBB6opUZAw1rgyw6RkNmZvbWQ4mv/fhXtxnb8l/b6BeDPIthUwwTztzSZUu1uxa8o+7Tuw+uFmw+Tmmh4rhlRL0HGl7LPfyr5GMsAuGoYBI4zv+cRxDtXscU7MM9I+mmXOjV/4tl21Hr0YOD1fa1vAIdcKCVqfBVhTYFFUOMKbb8FgQ0IXjas0kZr/9wPOFaNl3nhDKUR0fr1jqdbQGqqnVIFeRnuPm8suYo6Sz/UFElZQTl9eu/176jprQY/eJo8fG3BevjBY45nblBVSZ1r5943etS28+vtN3tChk77DBUGyAftkCDXetjVHFsyLfv9tWOBAoA2bZsf05cyWBqh3PmGI2QZUiLGCES+VjwtAbL6bPByCqRn5415mARwkJLB9JyZ+88p5XIPFNAMpfnB3PIJsI5JPrWSR0sw6IgJ2ZYm4JqK0nb4/4mnTFaQrLEooRenJvztDf347nJ1nfUKA8ZPKTDLZHUSSTFNA/LcSKXTOapG08/sPTi/e/vHTh5I4xzmh+bY84+a74aI+dv7O1wLEmgnLqCfGzIh2PU/ziq7P3BlQ1Zzx+X7s97HH+ho6fJlH8tNgSIMYNy1kRbUF0hNJU2DwQViQRYIUnad80sBPYto4LyDjhwJRQKWoxVLrQctly6a/ZfNIn6xKGGa0IlKK6pFlsrJmZ5QkKCat6wYcOnnnqa7kfrj8RdSIOBSMkcEszhvy4f2ZPQb9N3TZL/OnQ+7dDFDJmuZB1MzrZQqllmUuVz4Hzj2bNRTyc4Zq7Tiam05UJX0h3f2UUQtEuy4RhsMZAXHJpRzalUrxmjIQ/48CAIP5DB8/ildBIKrI3wL0iIhD6t6HLlaH1aJ5IHsZJ/SbYlKV1JyK0ebKMa2yvZOXYVlzAtUqs5/iLZuayclJT086afVXVKi1defoUXIjtPpVBaCDk4FgwtaWnNrzO6nDv4V1ATOQoGz1xvo3z8REQQSgh9vSlF5KdDSf6MaK6fjGxGBENLPr4UMHXb7iO5ue7/OqJ6tapGt60NhQRavtWAqd1MmjPtwDOhkKTWYYFt6gRAVdVlYAUpBnlAjMQKJliZFA8w6bketA7IqmAZymtuc240VK3i3aaWP6QuQz5fmNl5QOKIOOOIr2WX9JtaSx3Kp06f0v6x0/333R8VFU0mmP7lXm1poWaj8Xu+qRcsf1xup39zoCwHhYhAHC4nyUp9WlRn49l0Uv4qDIDrkWGghQRjCH3gYtg/J7y04NOFn15Lkb1h7S4Cx7OeumXta12haUNu8fc1uuSZlReml2O0dyUfvrAyKGWYwXa+wPGcexstfqAJNL1rffAkFEVrg5roC3N4PAiCd0TMCFlGhCat6KtOlK6YoqqPgdlZA7SsfwuuK2UwbyM8WM1t/hUt9dQrveI3ttAU34dTyz179qhVcpUqVZ54/AlS8pe//LUl/qKws6Vko6GTdJp8LOSSmozpgwPlvkb4oIj6QWLjmRHgq7YwEDgmH784YuyOP1bHx8dfSLR92IPRklN1f6+OzWoYDZ7Q4NsbNK0dWCSfFMqF63O8TpQEMiQpPMS/XVggNDwy9K5GQfKjnmJFiJTf1saKIVKDVSSBJ0jt2jEMQTahdUZJdSVJHiazmKiRdRn/aFj12cg6kvafaqgVqrzmMKt6lRSKJbVXV1UQs2evbXu4bdu21apVQ3PhBtsfpdJVr0vqY5GSEXqkZkgEgqO1ghihRCi9vSbeHEhpYfZz8MdR1MfgmHx84OAB9FNTU0+dOgXjkAL8vR3KnQuPn0+ZErOP/SNeUqI5aUC7T168vXAacesnCi0YFgmR17F1lThqVIkGbQHUIMjH8YhqazUHo5Bj5bxS1CCLDHOIjnCoFM30HJCiZjMUGopQPn2im6+tU62kpVqpQ/nI0SPqsiPaRLABx24uu1EiOWlTsvbgAXQn00lhyKVPAmiTlABJBs9xLauopYVQUFvysXfdD6sH1L2SGi+EZrP52LE8l42QizayWXXBFKlNzzTxSoUXKyM+2z3r+/iwmlUG3hpGei4S3Xdz3uwlSTlGo90ytAGxDQlM2Pr2HOGyiQTsrCY4hGyjkpQd4KftyjzKguSO/IMJJHPqj3CrdjXMsatZas9ihTdVZGUsQ6JrNHQNCwgJKE5aEQ5EW7pQ5plPfb3n6+vbokULZt2XcJVWJXEKPTNtIRBD0Vn7YTgxHpnXXz3xxfJ14+i2q+HDroWUNRNe8tc8z/nngmPyMftuSBs0aCArKD+XLhe449a5Vairla7iStvw6m71thMTlu3ldfQdEzbO+j5++4mrpGqtTjF5bkSFWeaBQkHKeQGXxwR4Ccprm1MtwCbIq2AxV4Ua5xuPJX0SewF6+NtjS/Ylyh5Qk3+58GM01PA1PH9/SxdUC1EpXShnZGao8xsMBlIy3Z2HHRSvj6Rt75z1l7xrIUlVW4FGadDOH1tnyBv4tybuh7/cLsQjJEyUFjmXd8g4TveQWwXQhqoPguMx26XfE5L9fH0b1LdB+fTp00zqkHpH1otsVtPhkOtCMM17FjDdZ8rGh9/bOnLh7iK8l3ZlGg1ouCkJC8sbYNHRtFz5lp5qpaDKAkTG6EIwBZFqKBRQhhTe5kTpSmgaDClmac6exNEbTkJrjly5lnZdDOZphQdLNQCzTQAAEABJREFUqzy/qsMm88T+EZ0bFO15Q7XWMqULZe1MRqPRx9vHZM5JyjTnehkZ0lYXYb5pb19djBDI0oJm6NXLyzxT0odf/xEe4f2ta8ilReKHEiCmD4gVRuTjXj9cX00oPeVI+ftr/7wEVccU6GNYOub2ofc0K3Zu1vql8ADT1B4Pv/NLnae/HTT3d/ERMFFSazXz8zmFVhcCB4olkIIUNk9jw7EqVqxsykpXHZSxaOtoOAWjeUbtDa2wsX4yzDZ13luKbWqNe8H6Gj2jwmv8/M8uPLPyAC2EJWmtayqJj6LYpptyr1y1pWrVtLXH2UbZiRQVp/xrq8Lo5LhFiR82SD+PpEmtqw5KC+oKaz6Ou2xfomBVKFGizXw8YsmYO/rc0Tgk0NctmGZSYE35MXzO9v7vbnl05pZZ38fzhOAKprF1A4FF515QgJzrMJpPxx6a+RQwspAd+i1S+VfrOlVf6Nni+xc6fvlEu9sby9sAsrTEP6ULZT9f+6cKf6NH9Wr2wpZ+qQKvANruiEAzEPes5x3y7Fh2LeTSQqPhWaOLqCtWnVLeGjqKbM2ahZQQfr6+PIR9OfLWNZO6TegfITCtmaRE7NnEa1sOnJ8QE9dt4k9gmjzNnrozj3mzWp7U6MzM0ZgCJhv4lK6s5yhKslz5yTV6QgqrNKqy1dzi0NpVlIrWnDh/bf/RxP2XszIzTUWzdKpdulAODg7maU8swGQyXU2+yq0k2FeuAYRQbo2Gm8/sIumCV7pgGsaOqve83RzSyJQ+GwWVqI8ve8+jPl51NkMVwmRkZp4+Y6uPa1SvgdAVYoN2zAMt5z/Tcevb9349/k4Kj4hG1UnVrtg601HQyfsgttKfWxj7xKztRX46FLgRrbOZlDEVfErP0qi2mtE8kLXoWX4xBFk6qonqxDKg/LKO5iqHKYtURu5Yf4St0mZ4GrYcT3otJq734jiubatGSX+XLpRZXQPrExhbGWfPnkXSrHZVWhuZzMNyt4junQHxYFrwv6Ranmp9w3INncfKuxapZilAuQwCDLZ8fD7Pc0ar6vL2pPYPVcS2ifDpSksBXb+mP3l67rCOayfe9fHzt771eHveUZeo9jCZPbJNPCHQ/no8aXxMXCG5udCFKphwplWYQq6xgFNvhSbOC9RhDCpsCklRsGRx9PNSRq50+EzyqFVHeErOO1LMXgHHU0xvDsxu73K7kJrNZl6XZGRm3n1zXSERLW/4WndIAq92dLldjSl1nkToP+Tj3IzlOVk7ZRwraDZ43Cfy8cpLee5Q9QK9G1b1Skq6ov4ZbFBQUHh4uJioGC2VNJgmVfOO+tDc3rwHEam6yLBWEhU4Bs0sY9Uff+/+8zJMQVTQ6UffMuTa58gsypgJssK0MIwq+UKYiNZqKHp2busF+7UNNEK8xBYKlrawReIn05TzbMxBHiQsJiX4pYFyCbw4MW3WrJnBGghel4Cz1nUCwqp6qyYPt9yt8lrmQEZzuv4Rd9DaSosAAzgW9TE49jDlSDxEi5CZc/o1lvP9gQMH1FflDRs0DAx0w0YPdRGw5iXIrKG3fP1K1Oo3u7/Ury3lR5EwLXDM4UDrY23fJEa3dEnJjuoUNhwb8kFWVbIO2ZTFUF5XyIJ8DePa11w1qI3lMxjVNS8d8ymjn58uZ5oL+vR2fmUnEk8nY24Zatq0aZvWbYSrhISE2NhYYPHIHQ2FJDw4u6WvvEFB1y9UZr70vuOPwGbQooyozvXrWkoLhhXy9OkscLzq/HULjhW5hzmHmPZrGmgy56z9fq0ik5tOHTvVrZPnJiBLrT8UauwtFInm/nD0lyOXOtTxnf5IxLa3uvOY6O/ix4kkiawsKf/YhTx+PlVhi9s4R4nDUSs6izllweaNQvy5GfKkYfsMhnIXcn2i9afSOHGu6zvULHUogyTwpM69Zu0aaoxHujRsFlYtN8sUeO1SvYAk/+be4NgjsAEMyfibpKixx4dKRkNwm26W0kKxJx+LugIcS3IyVj7Yac7xMJObc+6s7RdRt+qeP2L3xe1T1CXuBg8++KDgHbYzVuzj1UZRad7aw6kmOW5ckyN7hrv+cSI1K3PgZ7Pk10AOV+UGIQGR5A8MOXNVMDQtVk4Vch1eLRbLIv9KvJR66FzJrm1Jkk9JkWcuokH/h/qDKmFEubx16xau4F4RIUIiWnAM81da1Z1Xmi1Ovu2QX51XOygvRNItuxa2fMy+m4xjGb6S2YJjUvKYDiE8sa1cvVL9C8L2N7dv2cLy7Ijz0iDQHFziDw+UxsLKyGeRAO1U+VrF/7wyMW3cuHGvB3sJNKelpb33wXtJSUmj72vRtWlwrKnOpkut0MmtKm9unE0NPmwOptsmwDAi0lPetaDDBefTWeTj1SeuIfC4biITCwLNktn8RItqvPzcum0rWR8FqEqVKkOeGALjdkpNv55ZrA1RtcBw+5JwGHdWjgxMxSVzgR+uTzPlJifn2VEtxlGURVZmWQMHDFRfVVAxL/x8YYAxZ8aTtzQNCfj8bE+Ssce1eqA5PlN+1cfNa1L3+iHy9wfsxJZ8bMHxn8kAFxzTasjcu2nQm1H1EhPPz54z20zCxkaS2DmJ0vxvf4rMPc2FlMxvfz9lMudAPHofPnXVRb9qgeGifqFq6bkevEGEfky4tveSPRQ8CoaOc89FGHXfFJfTsoswryPVMoLyTe1uGjF8hEjMLGPZv5fFxCynzHjnoVZmY3DkL+M+S+gEmuVHQLP51dtqy5+1UEoLFcffHbwoAdN8BI4/vrehOT3lX+/8S92DCw0NfXnMy7zGYy63Ey+lKa8f/NevEO/wLmq+CtrtczlxeDAxPfzD3SHvx0K9vzyUojw4ONGXo6cdJpLabn7eTiFv10OAuKCawVToavLPV1JJGUGZZf6jxz+63d1NoJnXJfMXzN+wccNdLYPnP9WB3DzuQK/R8YNQe7L2HrW0yINjSf6zBQ+TWZAkSYEGSeDYmJ02Y+aMTZs3IYR8fX25bOo3sGySICkN4nU0BKxdd16qBUYRlsEOptBW0FnP39GWnDKElrxNxC+VBIIL6qry8mDKDsq8xCZTNm8m7xZzpMnJyRMnTVz93Spq3GXPRfZpW2tJQgQbFy88cJ8oLWw43vO3lJUtmcxaAsfTu9b//IEmAserNP99Zb++/fr07ssDGbM4p/q1NB/Pda7q7tGIUGef3bPkPCeT2kHKiSZDBSu39HX0Pw9ZcYypPRWUhu31lH7B8yrDbm7KDsosnOe/qVOmqrsKoHnmezMnvvF6/Srm+c90/HZY+1H3dgivdZEXIiqO1/x+ivMKScTFnEOhXLdOUK82IZsfDR/WPuTEkQPPDn9WfdRjir59+o4aOcrF0uKW8EI+aYRDN5K2Vu7YqJifCJND4cqazPIzlr2yFaMe1sTcv36+K8qqwySqmqQKtW4VHjXn5FGwmpMh5z4djpYplFkBRTNoppaFh9jQIKGOfnl0/L4/eEU8tEsAuxbg2BAwa8x2ac32kwLBtIA4uknwrD4tlt1Tb3mfps1ren/xxZIXR79IfWxWAk3p0rlz53Fjx5H+8ewKsb3duAwSM/cTZTVqgdEutMpDt9r+OEAZdKFxiAnVuZWRlGjYu1NtraPA9M7qXj1bFPgnYShYnFhNOAsWifNf6kq0auoCtEK38mUNZRZ/U7ubPv3kU2AHL2jnzp0vvfLS/sP7s5PmIfGpudTk3fD922tvGtFh5WOtVj7aYtOzN5+e0GXjkDbDI0PrSklff7Oid99eM9+fqW4hUx8PHTJ0wfxPXccxE/EK/d2nIuvVqgrvNirMES/t33+uc/2a+dKhE8MS4MAjv60CzdBA7yk3B/OWLv+0gBiyyBVlC6/8cuBQkbvU5F+MS2YuKZUDlFkXNcY7b79DMcDuL10o4sFelBY55p2Sz9jFy9ftjt1tyL7aulrubQ19oca+6akXz1JIjH99/HPPP/fOjHfY0VOTMTl+/LjxI0e+6GJdwXSCqKd7RIR+82q0ez+jLJznb0P8vfreUnfRS3c4+7y5XUrLhySbWyewEFZ2Cko3MMgvzEsa1dR/fVRNh8uwgZiZhB8YSDHnt4VEV6tgGbD+EgrWXp7fdlZ2h5xHtQid8oEyC+SFNmiePGlyu4h2bdu0nTT0YY9r/weOp49f+a8Z/xr27LA+/fo8+tijI0eNpBoe8NiA+3vdP3bcWKoRQMwGCB4gigpevpDjBz46sKg4xhwCzewJis/dv/V4+6H3NItuW5uqA2K0hES+xw8Oh97Z+K0B7dZM6rZkRKf8AKpRxSuqdS0bhdeICq8R3TTYQo0Co6H6AdH1A6Ka14iu60+hZaGGQdFQvYBohbqG+gmKbl6ja03v6CbVohsGQl3DAvrU9R3VKmhOp5pf3hHyy4Dw9+9pwFHbHV1dQ257f4+utXxsVMe/q0phAfiBcChTk2ryFM1r3Fnbr2qObeutUYh/NEuCmgRHKyTWHNUyhPVHcyCQ9dA4TJla1+rYJJgg2K2nqN1yg7JYqADi5KmTa3iczK361PTxK7/avlEM8VAIamP/iKUappAQOVgMgeCgoKAe3XssmL/gzUmTyfFCXpKWUzvmgZazht6yYmz0f96+F4qf27uEtP3tHvjBIW5xzhRGRzsA8p3h6fbfuEDfDmiJGq1zWnlfAxRoVWKrZ8ZdYZRn94RVcVhUEDrKLVXfFUZMgWf2oDAXhH/kdiTWTOuECILwUOy2nKHMuqluW9XzNnjVy63SJTskAIwidEINGzakLJ770dx3Z8yMuiOqeMm4IP9ALdDHEBLgDVHOlpBwAuEQtwXNiJxRdEqbmEXMReuQUCjeGjBUHcKX3InqrUhM+UOZ5XoEhEM8uk2f9vau33Z9FfPV5DcnD3tqWN8+fUm9tBBbbHM+mvPjuh83/LBh7CtjO3Xq5F4QswydKnUEKgSUDZ4eEHE0GuT1sMVB7QteKaZJvbTQC8+/AKzZmUZNJz0C+SMgQye/tOJI9NRbcc5FBV9JRYdyBQ+fvryKE4EyhfK+uH2LFi9S6cSJE8tXLKeblJQkIiK6SCD4jMxMCIb320j+Pve3nQeEGzZuQAEGYuMZV5gIIbzJnLNr1y7M5308D0bMom3xiaEg/NDFHAaJUENCF4d0GUIOj2cYCB4hQzB0IfS3btsKIwg5ChBrww+jMAwhx4ouPPoqP2XaFCTIkaikNVeFgsEbblHABEPcqmujC4mjRgFNumIuTOBVoitGcYKCkBM6rMQQDIRzEUnOgpidVshRwxYFbHEl5PBI4FkSCg4PjVF3UZlCedu2bTPfnzl/wfzV361e/8P6Y38e42iRXL16VRyP6HLYKGzatOn8uXOvjhvLC5GNmzbOmj1r9JjRGzZsWLRkETxWc+bNgf/q668+nPUhEtzyAoVN6ISEk8v+vQxXFxIv8HJ7+AvD165bu+SLJU8+/STnSUyktsePH8cV5riaNn0aG9ixsbvnfzIfodA5c/oM/q7d67kAAAuKSURBVNd+v5ZuUtIV5DhnwTDQex+8l5khf1AYhi6Ew3Xr18FwFPgc8/KYJ4YMRufz//ucJV28eBGG0elvT09KSsI5PPrg4MmnnuSIDhw4gGTE8yMYZUYIZtgzT3NowhyJluZ+PJfVJiVdEa6IBkeNB1wRQ+jgoYPoExOxwmlvTQN8K1euZG2oQcSN7hfLvoBXFw//22/bWTaTsmCYKVMncyzbtm9b8fWKgYMGqpFkiElZAwsgMhiyVJIUS4JHwiXBSSG223dsR8KhsQCW5HbydLtH5w7NZvP9990/64NZ777zblRUNC87kKgmovvGhDdQmDplasq1FI4/vHn49CnTb7rpJk5SixYt2MeIjorGikdDeHamMW/UsNH0qdObN2uOTkpyChJc0XLB0L7y8itDBst/UbL5P5vp2hGuMMdVZGRkcnJyXJz8P0IgtFMTXVUOU7NmzTNnzjBjEqA8I/8FNUJVbeTzI/EZEBDAvrgQiiUJnokEGoQJCE5ISLi9y+0fzfqo293dzp0/x/tOoYn/02dOMxdBCAkJYS4hz98KV8hhmjZpSgyhPr3l/1Hu6NGjly5dYo+Ii/Do0SPTpk5jbaixPOJGt3bt2nSxVYkLTP32SpgffvyBNeBwxPAR6DiOpPW9nQg7atDpUwlEgFMze9bsNq3bkL9YAPJCqOjDZQ1lVpiRkQFGIXiHxNliNCszKyUlJS0trWnTph1uiRw5YiSIBG3sbxBTDGnh2ZaGD6oWRLBo4bVETuJsYdW3b983Jr7R896e2lGVxxBXvIBUJa4wXGNeXl57/7v32LFj4IDzpLUCNz4+PrTqy3l1lJUztPHnjVnXs4RQfNlNh/YdWMOwp4e9NOYlDkcM+XjLTuBRJqWRvEnhdFXiCuFKOH7iuCqBuX79OjGE4CHmYoW9e/VOTU3ds2cPL5U4XuQsr23btnS1iyRiYWFhe/bu4R4CxFEj4zJLaK1QdpC6Rnd1Eklhu+O3HZw7DhNbsEvbqlUrZhn14ihsuSCRuJ3KAcpc388898ykNyclJV1xeDzcfFFYumzpmbNyqkOHjXc2kknAnGm6+Sk+Pp7b3759+xo1aqSNFOdPKGNIFseJ6Nq1mL84+kUKOxBWvUaBHxazs6JLOmdSLhje7HDJIVGJo+DGSvZlXlUoGBbZsmXLnbt2JiUlYSiEouXWTHqu4l/Fx9dHSOo3aEi2JqdOeGPCyYST0NhXx2rRDDonTppIFST0RQuAiCFE7ueGfuTokdDQ0LvvuhuogVEkQs1hC76ZkRsOoNcqsFQMuWy0y9MqwNepXYcL8sDBA9wH6Krk5+cHH3VHFNHgXMC7ncoBypQKZJ0BAwYEBzsGzcMPPYwCcSdkrh+wt7d3drb892FkL9ethGZWVhYnm5sydcitnW4VwkLb69nXW7VqdfjwYaogTqHdl9OR9rrc1sVgMFBfcoPWevP28u75j56gnOwFbrRDv/z6y9hxY994843Y2Fgh5wYNeshweANM0D3d7tGGDg8sm7JN6IuWtEoMofDw8P1xcdQVXD8MVatWjYc2Clx4J8TtC7faOkEoJyVd4RJlhctjlguJtjUY5T9IYSWkcO4D2qEy4MsByhFtIrg0oYL2jPs/1J9RruDaobVFCEgGbEE8/OjD5BghsWu5HVN8c7JBwCnNfz7CiSes1CqcP8xxYmcoum3btP1u1ZqlS77gRYyaDsWQaM+fl79uBj+iK1oQ2SK8BYUsea5BgwagTchFO3jQYF5etmrZKv5IPDdoIVRbLhjewFNxsjyEvn6+tOnp6YMHD+FNJ7xK+w/sJ+tzaM8981xwtWDo3nvv1YaORNu3b9+eeWsnCgNiCHFbp+wmcxOZkaNGkmsvXLhARaT6d8gQBF5IMe/JkydRoEtLvUFCpcgmqnTzk1mplbk7MemWrVvEoYl8TFWJPhsgnAWxqULXvVQOUL585TLAgpKse3CkInZw1CPk5sgoRASJGmmPXQV0jh47KiKSPwTkg2rVqtWsWVOtKIQO93Ey7u+7fmfzhIePS5cvMQsB1d6g0cQccEDwKrEk6GryVfJTwqkETFgDo5xOWkFtWrcxGo0U9Jw8IVFbitfNm38G6CRmDkSVC4bVchMnMUNIwuqFoUaSTkyUrxkkdkQQwLRddrfT0XaTryYTQEFcS8B97D/HzpwxkyINtV+3/EpbEAFBKl3uijwJgHvUqNkIAg+jOLS7nhnVEitEgWdN7pDaQ+NqZxncoDgL3DbZ3qGcMzn5IKjWqWt8OUB51epVjwx45Iknn1BT7DvvvsM9a+XqlWLNlK0oQFSuFBsge9izwwgBGxcdIzsKHSctZ0Idffyxx3Eyecrk2XNnUyw++sijP/z0A1t7fr5y6aaqOWRYEkQCY0uB6+GubnexTpz069NP1W/evDnnmG7+hTEpB0KNS0JVv84UTUhckORRLlS6UGRkR2bhCZJZMESiUkTbCC4YcMBiEjT/Ka2q4IiR0CeAEFYU5dQ/5HIS7cABA9HftXsXNzoYJ8QR8SQgFAjXs8OeNZlMOBz85GCBUTGkbckIBB+k3nbbbaQVMdRY+RYU7ga9+/bmVHbu3Jm0HRMTwx0pOzvPt7AK/WK3ZQrlbt26kRgETZsyLTIycuLrE0WXlihru0gaNmzE4/yC+QvgF3668LXxrwUHy1/4wkWP5M6ud3LYxIXtpGeefqZqYBAekHPu6eKKJ272+5YuXoqQ2+Knn3zarFn48b+Okw5RxhbCnFH04QUFB1fHFqEg1jxq5KjPPvlMdHHCdkrtOnXocnZZz1vT3oKPaNeO9cDgUCwDnklXfrMSxtfP75V/voJbMA0z/LnhSDBh5Yyi7+frO3XyVHGkSJiO+kqsByiwQ/fF4i+QQ5izQjFEy8YlbpFwUTHKkjhqGJXY9kEBK3EzCQ+XdzPZScAWHYawhWcNdMXiWRUMhzbhtQkIsWW1Tz319KLPF9GFOC7hAUMiyaT4YQGEEYYFEGcRFiTojBs7bvHnizFkL++jDz5iRnwyI0fNqLuoTKHMXZgbnEoEt0f3HmqX5yRtFzmHSkA5qfC06IvDRhMJ55guQqwYZZdDldNFiC0exKR0YUgD/fv1JzejjC2EOa7QhxeECcoIBWGFH7Y+1C626NBFiAm28EhYDwwOxTLg8SPMGUWNLq5gICQQEtTQx48YogvhmS5CQfhEghwStkJOSxcnuEKfUdQEAy+IURjUUIbQREIXBjk8DHLWQJeJYBDCIMQbQqGMGkN0IVUBHaKBGhLmRVMwCOHRpEWHIXToilFcIccbQ26kMoWyG9ddPFcEkYACr+KZ61YVOQL/W1CuyGdCX1sJI6BDuYQB1M0rSgR0KDs4E7qoMkZAh3JlPGv6mh1EQIeyg6DoosoYAR3KlfGs6Wt2EAEdyg6CoosqYwR0KFfGs6av2UEESgHKDmbRRXoESj0COpRLPcT6BGUTAR3KZRNnfZZSj4AO5VIPsT5B2URAh3LZxFmfpdQjoEO51EP8PztBGR+4DuUyDrg+XWlFQIdyaUVW91vGEdChXMYB16crrQjoUC6tyOp+yzgCOpTLOOD6dKUVAR3KpRXZkvrV7YsYAR3KRQyYrl5RI6BDuaKeGX1dRYyADuUiBkxXr6gR0KFcUc+Mvq4iRkCHchEDpqtX1AjcqFCuqPHW11VqEdChXGqh1R2XbQR0KJdtvPXZSi0COpRLLbS647KNgA7lso23PlupRUCHcqmFVndcthFwDOWyXYM+mx4BN0RAh7Ibgqi7qAgR0KFcEc6CvgY3RECHshuCqLuoCBHQoVwRzoK+BjdEQIeyG4J447qoTEemQ7kynS19rU4ioEPZSXD0ocoUAR3Klels6Wt1EgEdyk6Cow9VpgjoUK5MZ0tfq5MI6FB2EpySDun2ZRkBHcplGW19rlKMgA7lUgyu7rosI6BDuSyjrc9VihH4fwAAAP//IiVUpAAAAAZJREFUAwB2+cW5RhP0UgAAAABJRU5ErkJggg==";
    const lineRows = (po.po_line_items || [])
      .map((li) => `
        <tr>
          <td>${li.parts?.part_no || "—"}</td>
          <td>${li.parts?.sku || "—"}</td>
          <td style="text-align:right">${li.qty}</td>
          <td style="text-align:right">${money(li.unit_cost)}</td>
          <td style="text-align:right">${money(Number(li.qty) * Number(li.unit_cost))}</td>
        </tr>`)
      .join("");
    const total = (po.po_line_items || []).reduce((s, li) => s + Number(li.qty) * Number(li.unit_cost), 0);

    const html = `
      <html>
        <head>
          <title>${po.po_no}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
            .company-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #eee; padding-bottom: 16px; margin-bottom: 24px; }
            .company-header img { height: 100px; }
            .company-contact { text-align: right; font-size: 12px; color: #444; line-height: 1.5; }
            .company-contact .name { font-weight: bold; font-size: 14px; color: #111; margin-bottom: 2px; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .meta { color: #555; font-size: 13px; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border-bottom: 1px solid #ddd; padding: 8px; font-size: 13px; text-align: left; }
            th { color: #666; text-transform: uppercase; font-size: 11px; }
            .total-row td { font-weight: bold; border-top: 2px solid #333; }
          </style>
        </head>
        <body>
          <div class="company-header">
            <img src="${LOGO_DATA_URI}" alt="SDR Electric, Plumbing & Heating Inc." />
            <div class="company-contact">
              <div class="name">SDR Electric, Plumbing &amp; Heating Inc.</div>
              8221 County Rd 21<br/>
              North Augusta, ON Canada K0G 1R0<br/>
              Phone: (613) 926-1623<br/>
              Email: info@sdrelectric.ca
            </div>
          </div>
          <h1>Purchase Order ${po.po_no}</h1>
          <div class="meta">
            Vendor: ${po.vendor}<br/>
            Delivered To: ${po.locations?.name || "—"}<br/>
            Date: ${fmtDate(po.po_date)}
          </div>
          <table>
            <thead>
              <tr><th>Product</th><th>Code/SKU</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr>
            </thead>
            <tbody>${lineRows}</tbody>
            <tfoot>
              <tr class="total-row"><td colspan="4">Total</td><td style="text-align:right">${money(total)}</td></tr>
            </tfoot>
          </table>
        </body>
      </html>
    `;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    win.focus();
    // Small delay so the new window finishes rendering before the
    // print dialog opens -- calling print() immediately on some
    // browsers fires before layout is ready and prints a blank page.
    setTimeout(() => win.print(), 300);
  };

  if (loading || !po) {
    return (
      <Nav title="Purchase Order">
        <div className="p-6 text-sm text-slate-500 f-mono uppercase tracking-widest">
          {error || "Loading..."}
        </div>
      </Nav>
    );
  }

  const total = (po.po_line_items || []).reduce((s, li) => s + Number(li.qty) * Number(li.unit_cost), 0);
  const anyReceivable = (po.po_line_items || []).some(
    (li) => Number(li.qty_received || 0) < Number(li.qty)
  );
  const receivedLines = (po.po_line_items || []).filter((li) => Number(li.qty_received || 0) > 0);
  const returnedLines = (po.po_line_items || []).filter((li) => Number(li.qty_returned || 0) > 0);

  return (
    <Nav title="Purchase Order">
      <div className="p-4 md:p-6">
        {/* ================= HEADER ================= */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/purchase-orders")}
              className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <ShoppingCart size={17} className="text-orange-400" />
                <span className="text-lg font-medium text-slate-100">{po.po_no}</span>
                <Badge className={STATUS_STYLES[po.status] || STATUS_STYLES.Open}>{po.status}</Badge>
              </div>
              {user && (
                <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5 ml-6">
                  <User size={11} /> {user.email}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {anyReceivable && po.status !== "Cancelled" && (
              <button
                onClick={() => setReceiveModalOpen(true)}
                className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800 flex items-center gap-1.5"
              >
                <PackageCheck size={14} /> Receive
              </button>
            )}
            <button
              onClick={() => setReturnModalOpen(true)}
              className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-400 hover:bg-slate-800 flex items-center gap-1.5"
            >
              <RotateCcw size={14} /> Return
            </button>
            <button
              onClick={() => setEmailModalOpen(true)}
              className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-400 hover:bg-slate-800 flex items-center gap-1.5"
            >
              <Mail size={14} /> Email
            </button>
            <button
              onClick={exportPdf}
              className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-400 hover:bg-slate-800 flex items-center gap-1.5"
            >
              <FileDown size={14} /> PDF
            </button>
            <button
              onClick={clonePO}
              disabled={cloning}
              className={`px-3 py-2 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800 flex items-center gap-1.5 ${cloning ? "opacity-60 pointer-events-none" : ""}`}
            >
              <Copy size={14} /> {cloning ? "Cloning..." : "Clone"}
            </button>
            <button
              onClick={() => router.push(`/purchase-orders?edit=${po.id}`)}
              className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2 rounded border border-red-900/50 text-red-400 hover:bg-red-950/30"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {comingSoon && (
          <div className="text-xs text-amber-400 mb-3 border border-amber-900/40 bg-amber-950/20 rounded px-3 py-2">
            {comingSoon} isn't built yet — coming in a future update.
          </div>
        )}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        {/* ================= 3-CARD SUMMARY ================= */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Panel title="Purchase Information" icon={Building2}>
            <div className="text-xs text-slate-500">Vendor</div>
            <div className="text-sm text-slate-100 mb-2">{po.vendor}</div>
            <div className="text-xs text-slate-500">Delivered To</div>
            <div className="text-sm text-slate-100 mb-2">{po.locations?.name || "—"}</div>
            {po.jobs && (
              <>
                <div className="text-xs text-slate-500">For Job</div>
                <div className="text-sm text-slate-100">{po.jobs.job_no} — {po.jobs.client}</div>
              </>
            )}
          </Panel>

          <Panel title="Dates & Status" icon={Calendar}>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-slate-500">Purchase Date</div>
                <div className="text-sm text-slate-100">{fmtDate(po.po_date)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Deliver By</div>
                <div className="text-sm text-slate-100">{fmtDate(po.delivery_date) === "—" ? "N/A" : fmtDate(po.delivery_date)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Sent On</div>
                <div className="text-sm text-slate-500">Not Sent</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Status</div>
                <Badge className={STATUS_STYLES[po.status] || STATUS_STYLES.Open}>{po.status}</Badge>
              </div>
            </div>
          </Panel>

          <Panel title="Payment" icon={DollarSign}>
            {/* No payment tracking table yet -- Total Payable is derived
                from line items (real); everything else is a static
                placeholder until an amount_paid/due_date schema exists. */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">Status</span>
              <Badge className="border-red-400/30 text-red-400">Unpaid</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-slate-500">Total Payable</div>
                <div className="text-sm text-slate-100">{money(total)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Amount Paid</div>
                <div className="text-sm text-slate-100">{money(0)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Payment Date</div>
                <div className="text-sm text-slate-500">Not Set</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Due Date</div>
                <div className="text-sm text-slate-500">Not Set</div>
              </div>
            </div>
          </Panel>
        </div>

        {/* ================= LEGACY STATUS BUTTONS (kept for Open/Ordered/Cancelled) ================= */}
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-xs f-mono uppercase text-slate-500">Change Status:</span>
          {STATUSES.map((s) => {
            const isReceived = s === "Received";
            return (
              <button
                key={s}
                onClick={() => !isReceived && changeStatus(s)}
                disabled={statusSaving || s === po.status || isReceived}
                title={isReceived ? "Receive line items instead — status updates automatically once everything's in." : undefined}
                className={`px-3 py-1.5 text-xs rounded border ${
                  s === po.status
                    ? "opacity-40 cursor-not-allowed border-slate-700 text-slate-500"
                    : isReceived
                    ? "opacity-30 cursor-not-allowed border-slate-800 text-slate-600"
                    : "border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* ================= TABS ================= */}
        <div className="flex gap-4 border-b border-slate-800 mb-4 text-sm">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-2 px-1 ${tab === t.key ? "text-orange-400 border-b-2 border-orange-500" : "text-slate-500"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ================= PURCHASE LINES TAB ================= */}
        {tab === "lines" && (
          <Panel title="Purchase Lines" icon={Package}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <Th>Product</Th><Th>Code/SKU</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Receivable</Th>
                    <Th className="text-right">Returned</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {(po.po_line_items || []).map((li) => {
                    const received = Number(li.qty_received || 0);
                    const ordered = Number(li.qty);
                    const receivable = Math.max(ordered - received, 0);
                    return (
                      <tr key={li.id} className="border-t border-slate-800/70">
                        <Td>{li.parts?.part_no || "—"}</Td>
                        <Td className="f-mono text-xs text-slate-400">{li.parts?.sku || "—"}</Td>
                        <Td className="text-right f-mono">{ordered}</Td>
                        <Td className="text-right f-mono">{money(li.unit_cost)}</Td>
                        <Td className="text-right f-mono">{money(Number(li.qty) * Number(li.unit_cost))}</Td>
                        <Td className="text-right f-mono text-emerald-400">{received}</Td>
                        <Td className="text-right f-mono">
                          {receivable > 0 ? <span className="text-amber-400">{receivable}</span> : <span className="text-slate-600">0</span>}
                        </Td>
                        {/* Real returned qty now (was a static 0 placeholder) */}
                        <Td className="text-right f-mono">
                          {Number(li.qty_returned || 0) > 0
                            ? <span className="text-red-400">{li.qty_returned}</span>
                            : <span className="text-slate-600">0</span>}
                        </Td>
                        <Td>
                          <div className="flex gap-1.5 justify-end">
                            <IconBtn onClick={() => flagComingSoon("Editing individual line items")}><Pencil size={12} /></IconBtn>
                            <IconBtn danger onClick={() => flagComingSoon("Deleting individual line items")}><Trash2 size={12} /></IconBtn>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700">
                    <Td colSpan={4} className="text-slate-400 f-mono text-xs uppercase">Total</Td>
                    <Td className="text-right f-mono text-emerald-400 font-medium">{money(total)}</Td>
                    <Td colSpan={4}></Td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>
        )}

        {/* ================= RECEIVED ITEMS TAB ================= */}
        {tab === "received" && (
          <Panel title="Received Items" icon={PackageCheck}>
            {receivedLines.length === 0 ? (
              <div className="text-sm text-slate-500 p-2">Nothing received on this PO yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead><tr><Th>Product</Th><Th>Code/SKU</Th><Th className="text-right">Received Qty</Th></tr></thead>
                  <tbody>
                    {receivedLines.map((li) => (
                      <tr key={li.id} className="border-t border-slate-800/70">
                        <Td>{li.parts?.part_no || "—"}</Td>
                        <Td className="f-mono text-xs text-slate-400">{li.parts?.sku || "—"}</Td>
                        <Td className="text-right f-mono text-emerald-400">{li.qty_received}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[11px] text-slate-600 mt-2 px-1">
                  Shows current received totals per line — a timestamped receiving history
                  (who received what, and when) would need its own table. Future session.
                </div>
              </div>
            )}
          </Panel>
        )}

        {/* ================= RETURNS TAB ================= */}
        {tab === "returns" && (
          <Panel title="Returns" icon={RotateCcw}>
            {returnedLines.length === 0 ? (
              <div className="text-sm text-slate-500 p-2">Nothing returned on this PO yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead><tr><Th>Product</Th><Th>Code/SKU</Th><Th className="text-right">Returned Qty</Th></tr></thead>
                  <tbody>
                    {returnedLines.map((li) => (
                      <tr key={li.id} className="border-t border-slate-800/70">
                        <Td>{li.parts?.part_no || "—"}</Td>
                        <Td className="f-mono text-xs text-slate-400">{li.parts?.sku || "—"}</Td>
                        <Td className="text-right f-mono text-red-400">{li.qty_returned}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[11px] text-slate-600 mt-2 px-1">
                  Shows current returned totals per line — a timestamped return history
                  (who returned what, when, and why) would need its own table. Future session.
                </div>
              </div>
            )}
          </Panel>
        )}

        {po.notes && (
          <Panel title="Notes" icon={FileText}>
            <div className="text-sm text-slate-300">{po.notes}</div>
          </Panel>
        )}

        <Panel title="Attachments" icon={FileText}>
          {attachments.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {attachments.map((att) => (
                <div key={att.id} className="flex items-center justify-between border border-slate-800 rounded px-3 py-2">
                  <a
                    href={attachmentUrl(att.file_path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-orange-400 hover:underline truncate mr-3"
                  >
                    {att.file_name}
                  </a>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-600">
                      {att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ""}
                    </span>
                    <IconBtn danger onClick={() => deleteAttachment(att)}><Trash2 size={12} /></IconBtn>
                  </div>
                </div>
              ))}
            </div>
          )}
          <label
            className={`block border border-dashed border-slate-700 rounded p-8 text-center cursor-pointer hover:border-slate-600 ${uploadingFile ? "opacity-60 pointer-events-none" : ""}`}
          >
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              onChange={(e) => uploadAttachment(e.target.files?.[0])}
              disabled={uploadingFile}
            />
            <FileDown size={20} className="mx-auto mb-2 text-slate-600" />
            <div className="text-sm text-slate-400">
              {uploadingFile ? "Uploading..." : attachments.length === 0 ? "No attachments yet — click to upload" : "Click to upload another file"}
            </div>
            <div className="text-xs text-slate-600 mt-1">PDF, DOC, DOCX, XLS, XLSX, JPG, PNG (Max 10MB)</div>
          </label>
        </Panel>
      </div>

      {receiveModalOpen && (
        <ReceiveProductsModal
          po={po}
          onClose={() => setReceiveModalOpen(false)}
          onReceived={() => { setReceiveModalOpen(false); fetchPO(); }}
        />
      )}

      {returnModalOpen && (
        <ReturnItemsModal
          po={po}
          onClose={() => setReturnModalOpen(false)}
          onReturned={() => { setReturnModalOpen(false); fetchPO(); }}
        />
      )}

      {emailModalOpen && (
        <SendEmailModal po={po} total={total} user={user} onExportPdf={exportPdf} onClose={() => setEmailModalOpen(false)} />
      )}

      {confirmDelete && (
        <DeletePOModal po={po} onCancel={() => setConfirmDelete(false)} onConfirm={deletePO} />
      )}
    </Nav>
  );
}

/*
 * =============================================================
 * RECEIVE PRODUCTS MODAL
 * =============================================================
 */

function ReceiveProductsModal({ po, onClose, onReceived }) {
  const receivableLines = (po.po_line_items || [])
    .map((li) => ({
      ...li,
      receivable: Math.max(Number(li.qty) - Number(li.qty_received || 0), 0),
    }))
    .filter((li) => li.receivable > 0);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set(receivableLines.map((li) => li.id)));
  const [amounts, setAmounts] = useState(
    Object.fromEntries(receivableLines.map((li) => [li.id, li.receivable]))
  );
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const visibleLines = receivableLines.filter((li) =>
    `${li.parts?.part_no || ""} ${li.parts?.sku || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelected = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === receivableLines.length) setSelected(new Set());
    else setSelected(new Set(receivableLines.map((li) => li.id)));
  };

  const updateAmount = (lineId, val, max) => {
    const n = Math.max(0, Math.min(Number(val) || 0, max));
    setAmounts({ ...amounts, [lineId]: n });
  };

  const submit = async () => {
    const receipts = receivableLines
      .filter((li) => selected.has(li.id))
      .map((li) => ({ line_item_id: li.id, qty: Number(amounts[li.id] || 0) }))
      .filter((r) => r.qty > 0);

    if (receipts.length === 0) {
      setError("Select at least one item and enter a quantity.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const { error: rpcErr } = await supabase.rpc("receive_po_line_items", {
        p_po_id: po.id,
        p_receipts: receipts,
      });
      if (rpcErr) throw rpcErr;
      onReceived();
    } catch (e) {
      setError(e.message || "Could not receive items.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Receive Products" icon={PackageCheck} onClose={onClose} wide>
      <div className="mb-3">
        <label className="text-xs text-slate-500 block mb-1">Date</label>
        <input
          type="date"
          className={`${inputCls} w-auto`}
          value={receiveDate}
          onChange={(e) => setReceiveDate(e.target.value)}
        />
        <div className="text-[11px] text-slate-600 mt-1">
          Date shown for reference only — not yet stored per receipt (would need a
          separate receiving-history table; future session).
        </div>
      </div>

      <input
        type="text"
        placeholder="Search products..."
        className={`${inputCls} mb-3`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="text-sm text-red-400 mb-3 border border-red-900/50 bg-red-950/20 rounded px-3 py-2">{error}</div>}

      <div className="border border-slate-800 rounded">
        <div className="grid grid-cols-[auto_2fr_0.8fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500 items-center">
          <input type="checkbox" checked={selected.size === receivableLines.length} onChange={toggleSelectAll} />
          <span>Product (UOM)</span>
          <span className="text-right">Quantity</span>
          <span className="text-right">Received</span>
          <span className="text-right">Receivable</span>
          <span className="text-right">Qty To Receive</span>
        </div>
        {visibleLines.map((li) => (
          <div key={li.id} className="grid grid-cols-[auto_2fr_0.8fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
            <input type="checkbox" checked={selected.has(li.id)} onChange={() => toggleSelected(li.id)} />
            <div>
              <div className="text-sm text-slate-100">{li.parts?.part_no || "—"}</div>
              <div className="text-xs f-mono text-slate-500">{li.parts?.sku}</div>
            </div>
            <div className="text-right f-mono text-sm text-slate-400">{li.qty}</div>
            <div className="text-right f-mono text-sm text-emerald-400">{li.qty_received || 0}</div>
            <div className="text-right f-mono text-sm text-amber-400">{li.receivable}</div>
            <input
              type="number"
              min="0"
              max={li.receivable}
              className={inputCls}
              disabled={!selected.has(li.id)}
              value={amounts[li.id]}
              onChange={(e) => updateAmount(li.id, e.target.value, li.receivable)}
            />
          </div>
        ))}
        {visibleLines.length === 0 && (
          <div className="p-4 text-sm text-slate-500">No matching items.</div>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
        <PrimaryBtn onClick={submit} className={saving ? "opacity-60 pointer-events-none" : ""}>
          <Check size={15} /> {saving ? "Saving..." : "Save"}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

/*
 * =============================================================
 * RETURN ITEMS MODAL
 * =============================================================
 *
 * Mirrors ReceiveProductsModal, but the eligible pool is "received
 * and not yet returned" (qty_received - qty_returned) instead of
 * "ordered and not yet received". Calls return_po_line_items,
 * which removes stock from inventory (the reverse of receiving).
 */

function ReturnItemsModal({ po, onClose, onReturned }) {
  const returnableLines = (po.po_line_items || [])
    .map((li) => ({
      ...li,
      returnable: Math.max(Number(li.qty_received || 0) - Number(li.qty_returned || 0), 0),
    }))
    .filter((li) => li.returnable > 0);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [amounts, setAmounts] = useState(
    Object.fromEntries(returnableLines.map((li) => [li.id, 0]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const visibleLines = returnableLines.filter((li) =>
    `${li.parts?.part_no || ""} ${li.parts?.sku || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelected = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const updateAmount = (lineId, val, max) => {
    const n = Math.max(0, Math.min(Number(val) || 0, max));
    setAmounts({ ...amounts, [lineId]: n });
  };

  const submit = async () => {
    const returns = returnableLines
      .filter((li) => selected.has(li.id))
      .map((li) => ({ line_item_id: li.id, qty: Number(amounts[li.id] || 0) }))
      .filter((r) => r.qty > 0);

    if (returns.length === 0) {
      setError("Select at least one item and enter a quantity to return.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const { error: rpcErr } = await supabase.rpc("return_po_line_items", {
        p_po_id: po.id,
        p_returns: returns,
      });
      if (rpcErr) throw rpcErr;
      onReturned();
    } catch (e) {
      setError(e.message || "Could not process the return.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Return Items — ${po.po_no}`} icon={RotateCcw} onClose={onClose} wide>
      <input
        type="text"
        placeholder="Search by product name, code, or SKU..."
        className={`${inputCls} mb-3`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="text-sm text-red-400 mb-3 border border-red-900/50 bg-red-950/20 rounded px-3 py-2">{error}</div>}

      {visibleLines.length === 0 ? (
        <div className="text-sm text-slate-500 p-4 text-center border border-slate-800 rounded">No items available to return.</div>
      ) : (
        <div className="border border-slate-800 rounded">
          <div className="grid grid-cols-[auto_2fr_0.8fr_1fr] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500 items-center">
            <span></span>
            <span>Product</span>
            <span className="text-right">Available to Return</span>
            <span className="text-right">Qty to Return</span>
          </div>
          {visibleLines.map((li) => (
            <div key={li.id} className="grid grid-cols-[auto_2fr_0.8fr_1fr] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
              <input type="checkbox" checked={selected.has(li.id)} onChange={() => toggleSelected(li.id)} />
              <div>
                <div className="text-sm text-slate-100">{li.parts?.part_no || "—"}</div>
                <div className="text-xs f-mono text-slate-500">{li.parts?.sku}</div>
              </div>
              <div className="text-right f-mono text-sm text-amber-400">{li.returnable}</div>
              <input
                type="number"
                min="0"
                max={li.returnable}
                className={inputCls}
                disabled={!selected.has(li.id)}
                value={amounts[li.id]}
                onChange={(e) => updateAmount(li.id, e.target.value, li.returnable)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
        <PrimaryBtn onClick={submit} className={saving ? "opacity-60 pointer-events-none" : ""}>
          <Check size={15} /> {saving ? "Saving..." : "Save Return"}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

/*
 * =============================================================
 * SEND EMAIL MODAL
 * =============================================================
 *
 * No email-sending service (Resend/SendGrid/etc.) is configured,
 * so this opens the person's own default email client via a
 * mailto: link, pre-filled with subject and body -- free, no API
 * keys, no backend. Limitation: mailto can't attach a file
 * (browser/OS restriction), so the PDF isn't auto-attached -- the
 * modal tells the person to use the PDF button first and attach
 * it manually. If you set up a real email service later, this
 * modal is where that API call would go instead.
 */

function SendEmailModal({ po, total, user, onExportPdf, onClose }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(`Purchase Order #${po.po_no}`);
  const [message, setMessage] = useState(
    `Dear ${po.vendor},\n\nPlease find attached the purchase order details for your reference.\n\n` +
    `Order Details:\n- Purchase Number: ${po.po_no}\n- Purchase Date: ${po.po_date}\n- Total: ${money(total)}\n\n` +
    `Thank you for your business.\n\nBest regards,`
  );

  const send = () => {
    if (!to.trim()) return;
    const body = encodeURIComponent(message);
    const subj = encodeURIComponent(subject);
    window.location.href = `mailto:${encodeURIComponent(to.trim())}?subject=${subj}&body=${body}`;
    onClose();
  };

  return (
    <ModalShell title="Send Email" icon={Mail} onClose={onClose} wide>
      <div className="mb-3">
        <label className="text-xs text-slate-500 block mb-1">From</label>
        <input className={inputCls} value={user?.email || ""} disabled />
      </div>
      <div className="mb-3">
        <label className="text-xs text-slate-500 block mb-1">To</label>
        <input
          type="email"
          className={inputCls}
          placeholder="Enter recipient email address"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="text-[11px] text-slate-600 mt-1">Opens in your own email app when sent — see attachment note below.</div>
      </div>
      <div className="mb-3">
        <label className="text-xs text-slate-500 block mb-1">Subject</label>
        <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className="text-xs text-slate-500 block mb-1">Message</label>
        <textarea
          className={`${inputCls} min-h-[160px]`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <div className="mb-1">
        <label className="text-xs text-slate-500 block mb-1">Attachments</label>
        <button
          onClick={onExportPdf}
          className="w-full flex items-center gap-3 border border-slate-700 bg-slate-900/60 rounded px-3 py-2.5 text-left hover:bg-slate-900"
        >
          <FileDown size={16} className="text-orange-400 shrink-0" />
          <div className="flex-1">
            <div className="text-sm text-slate-200">{po.po_no}.pdf</div>
            <div className="text-[11px] text-slate-500">
              Click to download — no email service is set up yet, so it can't attach
              automatically. Save it, then attach it manually in the email that opens.
            </div>
          </div>
        </button>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
        <PrimaryBtn onClick={send} disabled={!to.trim()}>
          <Mail size={15} /> Send Email
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

/*
 * =============================================================
 * DELETE PO CONFIRMATION
 * =============================================================
 *
 * Same custom dialog as the list page (not the generic ConfirmModal),
 * to match the exact reference wording/layout.
 */

function DeletePOModal({ po, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-sm w-full p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <Trash2 size={20} className="text-red-400" />
        </div>
        <div className="text-base font-medium text-slate-100 mb-2">Delete Purchase Order</div>
        <div className="text-sm text-slate-400 mb-1">Are you sure you want to delete this purchase order?</div>
        <div className="text-sm font-semibold text-slate-100 mb-2">Purchase # {po.po_no}</div>
        <div className="text-xs text-red-400 mb-5">This action cannot be undone.</div>
        <div className="flex justify-center gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-500">Delete</button>
        </div>
      </div>
    </div>
  );
}