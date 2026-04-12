package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.canhGioiEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CanhGioiRepository extends JpaRepository<canhGioiEntity, Integer> {
    canhGioiEntity findByCode(String code);

    List<canhGioiEntity> findByDaiCanhGioi(int daiCanhGioi);

    List<canhGioiEntity> findAllByOrderBySttAsc();

}