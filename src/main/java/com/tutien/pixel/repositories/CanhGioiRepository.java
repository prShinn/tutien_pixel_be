package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.canhGioiEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface CanhGioiRepository extends JpaRepository<canhGioiEntity, Integer> {
}