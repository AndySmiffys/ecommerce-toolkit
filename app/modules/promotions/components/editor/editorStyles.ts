/** Layout rules for the promotion editor: the two columns, the preview button and the narrow-screen layout. */
export const editorCss = `
s-button[data-preview-toggle] {
display: none;
}

@media (max-width: 1380px) {
.create-discount-layout {
grid-template-columns: minmax(0, 1fr) !important;
}

.desktop-preview-panel {
display: none;
}

s-button[data-preview-toggle] {
display: inline-flex;
}
}

@media (max-width: 800px) {
.create-discount-layout {
grid-template-columns: 1fr !important;
}

.discount-value-row,
.bxgy-pair-row,
.website-preview-grid,
.website-preview-collection-banner,
.website-preview-product-page,
.link-selector-layout,
.schedule-date-time-row {
grid-template-columns: 1fr !important;
}

.link-selector-layout > div:first-child {
border-right: 0 !important;
border-bottom: 1px solid #e3e3e3;
}
}
`;
