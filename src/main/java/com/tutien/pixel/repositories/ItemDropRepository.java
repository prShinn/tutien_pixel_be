package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.itemDropEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ItemDropRepository extends JpaRepository<itemDropEntity, Integer> {
    List<itemDropEntity> findByMonsterCode(String monsterCode);

    List<itemDropEntity> findByItemCode(String itemCode);

    List<itemDropEntity> findByQuestCode(String questCode);

    void deleteByMonsterCode(String monsterCode);

}
