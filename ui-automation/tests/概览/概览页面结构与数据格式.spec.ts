/**
 * 概览页面结构与数据格式：
 * - OverviewPage：页面对象，封装打开概览、找标题、找图表卡片
 * - 精确定位 Locator：先定位 article 卡片，再在卡片内断言文本
 * - 正则断言：校验“数字 + 单位”这类固定格式，不写死实时业务值
 */
import { expect } from '@playwright/test';
import { test } from './概览fixtures';
import { OverviewPage } from './概览测试辅助';
import { userStatePath } from '../登录状态';

test.describe('概览页面结构与数据格式', () => {
  // storageState：复用人工验证码登录后的 Cookie 和 localStorage
  test.use({ storageState: userStatePath });

  test('概览页正常打开并展示完整固定模块', async ({ authedPage: page }) => {
    // Page Object 封装概览页的打开和常用定位
    const overview = new OverviewPage(page);
    await overview.open();

    // 主标题使用精确文本定位，不再用整个 body 断言
    await expect(overview.mainTitle, '概览主标题 AI运营统计 未显示').toBeVisible();

    // 每个图表模块都先定位完整 article 卡片，再断言卡片的标题文字
    for (const title of [
      '平台调用趋势',
      '平台收入趋势',
      '模型调用/消耗分布',
      '租户运营排行TOP5',
      '问题分布图',
      '调用时段热力分布',
      '近24小时调用分布',
    ]) {
      const card = overview.getCard(title);
      await expect(card, `${title} 图表模块未渲染`).toBeVisible();
      await expect(
        card.getByText(title, { exact: true }),
        `${title} 标题文字未显示`
      ).toBeVisible();
    }
  });

  test('四个指标卡和周期卡展示合法格式及完整字段', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    // 四个指标卡分别定位，避免 body 中其他模块的相似文字造成误判
    for (const title of ['本月入驻租户数', '本月活跃租户数', '本月调用次数', '本月平台收入']) {
      const card = overview.getCard(title);
      await expect(card, `${title} 指标卡未渲染`).toBeVisible();
    }

    // 正则断言：校验指标展示为“数字 + 单位”的合法格式，不写死具体数字
    // [\d,]+ 兼容千分位逗号，例如 1,453
    await expect(
      overview.getCard('本月入驻租户数'),
      '本月入驻租户数格式错误，应为“数字 + 个”'
    ).toContainText(/本月入驻租户数\s*[\d,]+\s*个/);

    await expect(
      overview.getCard('本月活跃租户数'),
      '本月活跃租户数格式错误，应为“数字 + 个”'
    ).toContainText(/本月活跃租户数\s*[\d,]+\s*个/);

    await expect(
      overview.getCard('本月调用次数'),
      '本月调用次数格式错误，应为“数字 + 次”'
    ).toContainText(/本月调用次数\s*[\d,]+\s*次/);

    // 当前环境平台收入使用 $ 作为货币符号；[¥$] 同时兼容人民币/美元展示
    await expect(
      overview.getCard('本月平台收入'),
      '本月平台收入格式错误，应为“货币符号 + 金额”'
    ).toContainText(/本月平台收入\s*[¥$]\s*[\d,.]+/);

    // “运营周期统计”是独立标题，不是 article 卡片；先核对区域标题
    const periodHeading = page.getByRole('heading', { name: '运营周期统计', exact: true });
    await expect(periodHeading, '运营周期统计区域缺失').toBeVisible();

    // 今日/本周/本月是三个独立 article 卡片，通过卡片内标题精确区分
    for (const period of ['今日', '本周', '本月']) {
      const periodCard = page.locator('article').filter({
        has: page.getByRole('heading', { name: period, exact: true }),
      }).first();
      await expect(periodCard, `运营周期统计缺少周期卡：${period}`).toBeVisible();

      // 每个周期卡内必须包含固定字段：活跃租户数、调用次数、平台收入
      for (const field of ['活跃租户数', '调用次数', '平台收入']) {
        await expect(
          periodCard.getByText(field, { exact: false }),
          `${period}周期卡缺少字段：${field}`
        ).toBeVisible();
      }
    }
  });

  test('热力图包含完整星期和小时坐标', async ({ authedPage: page }) => {
    const overview = new OverviewPage(page);
    await overview.open();

    // 定位完整热力图卡片，避免在整个页面查找文本
    const heatmap = overview.getCard('调用时段热力分布');
    await expect(heatmap, '调用时段热力分布模块未渲染').toBeVisible();

    // 优先读取 HTML/SVG 的可访问文本；SVG 坐标轴文本属于 DOM
    const semanticText = [
      await heatmap.innerText(),
      ...(await heatmap.locator('svg text').allTextContents()),
      ...(await heatmap.locator('[aria-label], [title]').evaluateAll((elements) =>
        elements.flatMap((element) => [
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
        ].filter(Boolean) as string[])
      )),
    ].join(' ');

    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));

    if (days.every((day) => semanticText.includes(day)) && hours.every((hour) => semanticText.includes(hour))) {
      // 有语义文本时逐项断言完整星期和 00-23 小时坐标
      for (const day of days) {
        expect(semanticText, `热力图星期坐标缺失：${day}`).toContain(day);
      }
      for (const hour of hours) {
        expect(semanticText, `热力图小时坐标缺失：${hour}`).toContain(hour);
      }
      return;
    }

    // ECharts 等实现会把坐标直接绘制到 Canvas，Canvas 文本不会出现在 DOM 中
    const canvas = heatmap.locator('canvas').first();
    await expect(canvas, '热力图没有语义坐标，也没有 Canvas 绘图节点').toBeVisible();

    // evaluate 在浏览器页面中读取 Canvas 像素，检查画布确实有绘制内容
    const canvasState = await canvas.evaluate((element) => {
      const node = element as HTMLCanvasElement;
      const context = node.getContext('2d');
      if (!context || node.width === 0 || node.height === 0) {
        return { width: node.width, height: node.height, hasPixels: false };
      }
      const pixels = context.getImageData(0, 0, node.width, node.height).data;
      return {
        width: node.width,
        height: node.height,
        hasPixels: Array.from({ length: pixels.length / 4 }, (_, index) => pixels[index * 4 + 3])
          .some((alpha) => alpha > 0),
      };
    });

    expect(canvasState.width, 'Canvas 热力图宽度为0').toBeGreaterThan(0);
    expect(canvasState.height, 'Canvas 热力图高度为0').toBeGreaterThan(0);
    expect(canvasState.hasPixels, 'Canvas 热力图没有实际绘制内容').toBe(true);
  });
});