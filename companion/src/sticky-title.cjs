'use strict';

// Presentation only: never replace the saved title, excerpt or source.
function stickyItem(item, topics = [], previous) {
  const topic = topics.find(topic => topic.id !== 'unclassified' && topic.itemIds?.includes(item.id));
  const title = item.manualTopic || topic?.title || previous?.displayTitle
    || (item.title?.length <= 40 ? item.title : '回看笔记');
  return { ...item, displayTitle: title || '回看笔记' };
}

module.exports = { stickyItem };
