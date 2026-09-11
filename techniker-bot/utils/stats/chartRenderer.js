const { createCanvas } = require('@napi-rs/canvas');

function renderBarChart({ title, labels, values, valueLabel }) {
  const width = 1000;
  const height = 550;
  const padding = { top: 60, right: 30, bottom: 90, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 35);

  const maxValue = Math.max(...values, 1);

  ctx.strokeStyle = '#5c5f66';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  ctx.stroke();

  const barGap = 6;
  const barWidth = Math.max(chartWidth / values.length - barGap, 2);
  const rotateLabels = labels.length > 14;

  values.forEach((value, i) => {
    const barHeight = (value / maxValue) * chartHeight;
    const x = padding.left + i * (barWidth + barGap) + barGap / 2;
    const y = padding.top + chartHeight - barHeight;

    ctx.fillStyle = '#5865f2';
    ctx.fillRect(x, y, barWidth, barHeight);

    if (value > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(value), x + barWidth / 2, y - 5);
    }

    ctx.save();
    ctx.translate(x + barWidth / 2, padding.top + chartHeight + (rotateLabels ? 12 : 16));
    if (rotateLabels) {
      ctx.rotate(-Math.PI / 3);
      ctx.textAlign = 'right';
    } else {
      ctx.textAlign = 'center';
    }
    ctx.fillStyle = '#dddddd';
    ctx.font = '11px sans-serif';
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  });

  ctx.save();
  ctx.translate(18, padding.top + chartHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(valueLabel, 0, 0);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { renderBarChart };
