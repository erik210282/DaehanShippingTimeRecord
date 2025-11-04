import React from "react";
import { Page, Text, View, Document, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 18, fontSize: 10 },
  h1: { fontSize: 16, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4, gap: 6 },
  box: { border: 1, padding: 6, marginBottom: 6 },
  table: { display: "table", width: "auto", marginTop: 4 },
  tr: { flexDirection: "row" },
  th: { flexGrow: 1, border: 1, padding: 3, fontWeight: "bold" },
  td: { flexGrow: 1, border: 1, padding: 3 }
});

const cs = StyleSheet.create({
  page: { padding: 18, fontSize: 11 },
  h1: { fontSize: 16, marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4, gap: 6 },
  box: { border: 1, padding: 6, marginBottom: 8 }
});

export default function BOLAndCoverPdf({ data }) {
  const d = data || {};
  const today = new Date().toLocaleDateString();

  return (
    <Document>
      {/* PAGE 1 — Bill of Lading */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Bill of Lading</Text>
        <View style={styles.row}>
          <Text>Freight Class: {d.freight_class || "-"}</Text>
          <Text>Freight Charges: {d.freight_charges || "-"}</Text>
          <Text>Carrier: {d.carrier_name || "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text>Container Number: {d.trailer_number || "-"}</Text>
          <Text>Seal Number: {d.seal_number || "-"}</Text>
          <Text>Shipment Number: {d.shipment_number || "-"}</Text>
        </View>
        <View style={styles.row}>
          <Text>Booking/Tracking: {d.booking_tracking || "-"}</Text>
          <Text>PO: {d.po || "-"}</Text>
          <Text>Date: {today}</Text>
        </View>

        <View style={styles.box}>
          <Text style={{ fontWeight: "bold" }}>Shipper</Text>
          <Text>{d.shipper?.name}</Text>
          <Text>{d.shipper?.address1}</Text>
          <Text>{d.shipper?.city}, {d.shipper?.state} {d.shipper?.zip}, {d.shipper?.country}</Text>
        </View>

        <View style={styles.box}>
          <Text style={{ fontWeight: "bold" }}>Consignee</Text>
          <Text>{d.consignee?.name || "-"}</Text>
          <Text>{d.consignee?.address1}{d.consignee?.address2 ? `, ${d.consignee.address2}` : ""}</Text>
          <Text>{d.consignee?.city}, {d.consignee?.state} {d.consignee?.zip}, {d.consignee?.country}</Text>
        </View>

        <Text style={{ marginTop: 6, fontWeight: "bold" }}>Packaging & Dimension</Text>
        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={styles.th}>Qty</Text>
            <Text style={styles.th}>Type</Text>
            <Text style={styles.th}>Description</Text>
            <Text style={styles.th}>Dimension</Text>
            <Text style={styles.th}>Weight/Package</Text>
          </View>
          {d.paquetes?.map((p, i) => (
            <View style={styles.tr} key={i}>
              <Text style={styles.td}>{p.package_quantity}</Text>
              <Text style={styles.td}>{p.package_type}</Text>
              <Text style={styles.td}>{p.description}</Text>
              <Text style={styles.td}>{p.dimension || "-"}</Text>
              <Text style={styles.td}>{p.weight_per_package?.toFixed?.(3)}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 6 }}>
          <Text>Total Shipment Weight: {d.totalWeight} LB</Text>
          <Text>Total Shipping Units: {d.totalUnits}</Text>
        </View>

        <View style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: "bold" }}>Driver / Shipper / Receiver Signatures</Text>
          <Text>_________________________________________________________________________</Text>
          <Text>Names / Sign / In-Out Time / Dates</Text>
        </View>
      </Page>

      {/* PAGE 2 — Cover Sheet */}
      <Page size="LETTER" style={cs.page}>
        <Text style={cs.h1}>Cover Sheet</Text>
        <View style={cs.row}>
          <Text>Ship Date: {today}</Text>
          <Text>Shipment Number: {d.shipment_number || "-"}</Text>
        </View>
        <View style={cs.row}>
          <Text>Packing Slip Number: {d.packing_slip_number || "-"}</Text>
          <Text>Trailer Number: {d.trailer_number || "-"}</Text>
        </View>

        <View style={cs.box}>
          <Text>PO: {d.po || "-"}</Text>
          <Text style={{ marginTop: 4, fontWeight: "bold" }}>Consignee</Text>
          <Text>{d.consignee?.name || "-"}</Text>
          <Text>{d.consignee?.address1}{d.consignee?.address2 ? `, ${d.consignee.address2}` : ""}</Text>
          <Text>{d.consignee?.city}, {d.consignee?.state} {d.consignee?.zip}, {d.consignee?.country}</Text>
        </View>

        <View style={cs.box}>
          <Text>Carrier: {d.carrier_name || "-"}</Text>
          <Text>Supplier: Daehan Solution Nevada LLC</Text>
          {d.paquetes?.[0]?.part_number && <Text>Part Number: {d.paquetes?.[0]?.part_number}</Text>}
        </View>
      </Page>
    </Document>
  );
}
