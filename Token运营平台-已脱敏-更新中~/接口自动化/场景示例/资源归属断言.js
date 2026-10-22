/*
 * 根据已完成的资源归属确认与回读流程整理。
 * 公开示例使用构造变量名，省略认证与环境配置。
 * 用于 Apifox 后置处理，不是独立请求执行脚本。
 */
const response = pm.response.json();
pm.test('HTTP与业务返回成功', function () {
  pm.expect(pm.response.code).to.eql(200);
  pm.expect(String(response.code), response.message).to.eql('200');
});

const currentName = pm.environment.get('fixture_name');
const parentId = String(pm.environment.get('fixture_parent_id'));
pm.environment.unset('fixture_owned');
const matches = (response.data?.records || []).filter(
  item => item.name === currentName && String(item.parentId) === parentId
);

pm.test('本轮名称及父对象唯一匹配', function () {
  pm.expect(currentName).to.match(/^QA_RUN_/);
  pm.expect(matches).to.have.length(1);
  pm.expect(String(matches[0].id)).not.to.be.empty;
});

// 仅在资源归属检查成功后，允许后续写入和清理。
if (pm.response.code === 200 && String(response.code) === '200' &&
    currentName?.startsWith('QA_RUN_') && matches.length === 1) {
  pm.environment.set('fixture_id', String(matches[0].id));
  pm.environment.set('fixture_owned', 'yes');
}

/*
 * 后续独立详情查询将已保存字段与期望值比较。
 * 清理后查询列表，确认本轮资源已经不存在。
 * 负向场景需要明确的预期，任意 403 或 500 不能当作通过。
 */
