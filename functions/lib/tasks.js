const { CloudTasksClient } = require('@google-cloud/tasks');
const { PROJECT_ID, TASKS_QUEUE } = require('../config/services');

const client = new CloudTasksClient();

async function getQueueStatus() {
  const name = client.queuePath(PROJECT_ID, TASKS_QUEUE.region, TASKS_QUEUE.name);

  try {
    const [queue] = await client.getQueue({ name });

    // listTasks는 페이지당 최대치가 있어서 "대략적인 적체 여부" 확인용으로만 사용.
    // 큐가 수천 건씩 쌓이는 규모라면 Cloud Monitoring의
    // cloudtasks.googleapis.com/queue/depth 지표를 대신 쓰는 걸 권장.
    const [tasks] = await client.listTasks({ parent: name, pageSize: 100 });

    return {
      state: queue.state, // RUNNING / PAUSED / DISABLED
      pendingTasksApprox: tasks.length,
      pendingIsAtLeast100: tasks.length >= 100,
    };
  } catch (err) {
    return { state: 'UNKNOWN', error: String(err.message || err) };
  }
}

module.exports = { getQueueStatus };
